import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppThemeProvider } from '@/components/AppThemeProvider'
import { GlobalInteractionProvider } from '@/components/GlobalInteractionProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DesktopApp } from '@/desktop/DesktopApp'
import { useSurface } from '@/stores/surface'
import '@/styles/globals.css'
import { COURSES } from './courseData'
import { applyCourse, initializeCourseRuntime } from './runtime'
import './course.css'

function CourseApp() {
  const [course, setCourse] = useState(() => initializeCourseRuntime())

  useEffect(() => {
    const label = course.role === 'teacher' ? '切换到学生视角' : '切换到教师视角'
    const switchCourse = () => {
      const nextCourse = course.role === 'teacher' ? COURSES[1]! : COURSES[0]!
      applyCourse(nextCourse, 'conversations')
      setCourse(nextCourse)
      const url = new URL(window.location.href)
      if (nextCourse.role === 'teacher') url.searchParams.set('course', 'teacher')
      else url.searchParams.delete('course')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    const decorate = () => document.querySelectorAll<HTMLElement>('[role="menuitem"]').forEach((item) => {
      if (item.textContent?.trim() !== '退出登录') return
      item.dataset.courseRoleSwitch = 'true'
      item.setAttribute('aria-label', label)
      if (item.textContent !== label) item.replaceChildren(document.createTextNode(label))
    })
    const selectRole = (event: Event) => {
      if (!(event.target as HTMLElement).closest('[data-course-role-switch="true"]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      switchCourse()
    }
    const selectRoleWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') selectRole(event)
    }
    const observer = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes].some((node) => node instanceof HTMLElement && (node.matches('[role="menuitem"]') || node.querySelector('[role="menuitem"]'))))) decorate()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('click', selectRole, true)
    document.addEventListener('keydown', selectRoleWithKeyboard, true)
    decorate()
    return () => {
      observer.disconnect()
      document.removeEventListener('click', selectRole, true)
      document.removeEventListener('keydown', selectRoleWithKeyboard, true)
    }
  }, [course.role])

  useEffect(() => {
    const originalOpen = window.open
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      const href = String(url ?? '')
      if (href.startsWith('lingxiloop://canvas/')) {
        useSurface.getState().openCanvasPeek(decodeURIComponent(href.slice('lingxiloop://canvas/'.length)))
        return null
      }
      return originalOpen.call(window, url, target, features)
    }) as typeof window.open
    return () => { window.open = originalOpen }
  }, [])

  return <main className="course-app" onContextMenuCapture={(event) => {
    if ((event.target as HTMLElement).closest('[data-canvas-ui="root"], [data-message-bubble]')) event.preventDefault()
  }}>
    <div className="course-product-shell"><DesktopApp /></div>
  </main>
}

createRoot(document.getElementById('root')!).render(
  <AppThemeProvider><TooltipProvider><GlobalInteractionProvider><CourseApp /></GlobalInteractionProvider></TooltipProvider></AppThemeProvider>,
)
