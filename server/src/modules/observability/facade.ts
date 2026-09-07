import { pool } from '../../db/pool.js'
import { lingxiOSControl } from '../../agent-runtime/runtime.js'
import { ObservabilityApplication } from './application.js'

export const observabilityApplication = new ObservabilityApplication(pool, lingxiOSControl)
