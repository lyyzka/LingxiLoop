-- Applied to a rebuilt database. Ordinary migrations must never erase product data.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM companies) THEN
    RAISE EXCEPTION 'Closed education requires an operations-owned empty business database';
  END IF;
END $$;

ALTER TABLE companies DROP CONSTRAINT companies_personal_owner_check;
ALTER TABLE companies DROP COLUMN personal_owner_user_id;
ALTER TABLE companies DROP CONSTRAINT companies_type_check;
ALTER TABLE companies ADD CONSTRAINT companies_type_check CHECK (type='EDUCATION');
ALTER TABLE companies DROP CONSTRAINT companies_type_status_check;
ALTER TABLE companies ADD CONSTRAINT companies_type_status_check CHECK
  (status IN ('TRIAL','ACTIVE','GRACE_PERIOD','READ_ONLY','OFFBOARDED','RETENTION','ARCHIVED','DELETED'));
ALTER TABLE projects DROP CONSTRAINT projects_kind_check;
ALTER TABLE projects ADD CONSTRAINT projects_kind_check CHECK (kind IN ('TEACHING','INSTITUTIONAL_COURSE'));
ALTER TABLE projects DROP CONSTRAINT projects_kind_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_kind_status_check CHECK
  ((kind='TEACHING' AND status IN ('DRAFT','ACTIVE','COURSE_ENDED','READ_ONLY','ARCHIVED')) OR
   (kind='INSTITUTIONAL_COURSE' AND status IN ('DRAFT','ACTIVE','COURSE_ENDED','READ_ONLY','RETENTION','ARCHIVED','DELETED')));

ALTER TABLE users ADD COLUMN departed_at timestamptz;
ALTER TABLE users ADD COLUMN access_revoked_at timestamptz;
ALTER TABLE company_memberships DROP CONSTRAINT company_memberships_role_check;
ALTER TABLE company_memberships ALTER COLUMN role DROP DEFAULT;
ALTER TABLE company_memberships ADD CONSTRAINT company_memberships_role_check CHECK (role IN ('TEACHER','STUDENT'));
ALTER TABLE company_memberships ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE company_memberships ADD COLUMN ended_at timestamptz;
ALTER TABLE company_memberships ADD CONSTRAINT company_admin_teacher CHECK (NOT is_admin OR role='TEACHER');
ALTER TABLE company_memberships ADD CONSTRAINT company_ended_inactive CHECK (ended_at IS NULL OR status='SUSPENDED');
CREATE UNIQUE INDEX company_membership_single_company ON company_memberships(user_id) WHERE ended_at IS NULL;

-- The current membership row remains the stable FK target for company-owned records.
-- Every admission receives a distinct period, so old course grants cannot revive.
CREATE TABLE company_membership_periods (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  membership_id text NOT NULL REFERENCES company_memberships(id),
  role text NOT NULL CHECK (role IN ('TEACHER','STUDENT')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE UNIQUE INDEX company_period_current ON company_membership_periods(membership_id) WHERE ended_at IS NULL;
ALTER TABLE company_memberships ADD COLUMN period_id text REFERENCES company_membership_periods(id);
ALTER TABLE project_memberships ADD COLUMN company_period_id text NOT NULL REFERENCES company_membership_periods(id);
ALTER TABLE project_memberships DROP CONSTRAINT project_memberships_role_check;
ALTER TABLE project_memberships ADD CONSTRAINT project_memberships_role_check CHECK (role IN ('TEACHER','STUDENT'));

CREATE FUNCTION enforce_education_project_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member company_memberships;
BEGIN
  SELECT * INTO member FROM company_memberships WHERE company_id=NEW.company_id AND user_id=NEW.user_id FOR UPDATE;
  IF NEW.status='ACTIVE' THEN
    IF member.id IS NULL OR member.ended_at IS NOT NULL OR member.status<>'ACTIVE' OR member.role<>NEW.role THEN
      RAISE EXCEPTION 'active course membership requires matching active company identity';
    END IF;
    IF NEW.company_period_id IS NULL THEN NEW.company_period_id := member.period_id; END IF;
    IF NEW.company_period_id IS DISTINCT FROM member.period_id THEN
      RAISE EXCEPTION 'course membership belongs to an ended company period';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER education_project_member BEFORE INSERT OR UPDATE ON project_memberships
  FOR EACH ROW EXECUTE FUNCTION enforce_education_project_member();

ALTER TABLE company_invitations DROP CONSTRAINT company_invitations_role_check;
ALTER TABLE company_invitations ALTER COLUMN role SET DEFAULT 'TEACHER';
ALTER TABLE company_invitations ADD CONSTRAINT company_invitations_role_check CHECK (role='TEACHER');
ALTER TABLE company_invitations ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE company_invitations ADD CONSTRAINT teacher_invitation_named CHECK (email IS NOT NULL AND max_uses=1);
DROP TABLE subscription_usage_ledger;
DROP TABLE subscriptions;
DELETE FROM plans WHERE code IN ('PERSONAL_FREE','PERSONAL_PLUS','TEACHER_FREE','TEACHER_PRO');

ALTER TABLE company_onboarding_effects DROP CONSTRAINT company_onboarding_effects_kind_check;
ALTER TABLE company_onboarding_effects ADD CONSTRAINT company_onboarding_effects_kind_check
  CHECK(kind IN ('member_directs.seed','access.revoke'));
ALTER TABLE company_onboarding_effects ADD COLUMN revoked_at timestamptz;

ALTER TABLE ws_tickets ADD COLUMN company_period_id text REFERENCES company_membership_periods(id);
CREATE FUNCTION enforce_education_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ended_at IS NULL AND NEW.role<>OLD.role THEN
    RAISE EXCEPTION 'company identity is fixed until departure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER education_identity BEFORE UPDATE ON company_memberships
  FOR EACH ROW EXECUTE FUNCTION enforce_education_identity();

CREATE TABLE uploaded_files (
  storage_key text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  owner_user_id text NOT NULL REFERENCES users(id),
  company_period_id text NOT NULL REFERENCES company_membership_periods(id),
  document_id text REFERENCES documents(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
