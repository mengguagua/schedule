import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  Download,
  Eye,
  FileClock,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { api, ApiError, encryptPassword } from './api.js'
import { DialogProvider, useDialog } from './DialogProvider.jsx'
import { evaluateSchedule, expectedRestDays, isWorkday, listDates, weekday } from './lib/scheduleRules.js'

const actionLabels = { create: '新增', update: '修改', delete: '删除' }
const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六']

function formatChinaTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function getShanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function monthValue(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function nextMonth(year, month) {
  const date = new Date(Date.UTC(year, month, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}

function Button({ variant = 'secondary', icon: Icon, children, className = '', ...props }) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {Icon && <Icon size={16} strokeWidth={2} />}
      {children}
    </button>
  )
}

function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

function Spinner({ label = '正在加载' }) {
  return <div className="loading"><span className="spinner" />{label}</div>
}

function EmptyState({ icon: Icon = CalendarDays, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={24} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

function Modal({ title, description, children, onClose, footer, size = 'normal' }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  )
}

function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function Notice({ tone = 'info', title, children, action }) {
  return (
    <div className={`notice notice-${tone}`}>
      {tone === 'warning' ? <AlertTriangle size={18} /> : <Activity size={18} />}
      <div><strong>{title}</strong>{children && <p>{children}</p>}</div>
      {action}
    </div>
  )
}

function useAsync(load, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const run = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const data = await load()
      setState({ loading: false, data, error: '' })
      return data
    } catch (error) {
      setState({ loading: false, data: null, error: error.message })
      throw error
    }
  }, deps)
  useEffect(() => { run().catch(() => {}) }, [run])
  return { ...state, reload: run }
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const encryptedPassword = await encryptPassword(password)
      const result = await api('/api/auth/login', { method: 'POST', body: { username, encryptedPassword } })
      onLogin(result.user)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-shell">
        <section className="login-brand">
          <div className="brand-mark brand-mark-large"><CalendarDays size={25} /></div>
          <div className="login-copy">
            <span className="eyebrow">NURSE SCHEDULING</span>
            <h1>让每一次排班<br />清楚、公平、可追溯。</h1>
            <p>长白班护士组的月度排班工具。规则自动计算，特殊情况随时调整。</p>
          </div>
          <div className="login-calendar" aria-hidden="true">
            <div className="mini-calendar-head"><span>八月排班</span><span>31 天</span></div>
            <div className="mini-calendar-grid">
              {Array.from({ length: 21 }, (_, index) => <span key={index} className={[4, 10, 17].includes(index) ? 'mini-rest' : ''} />)}
            </div>
          </div>
        </section>
        <section className="login-form-panel">
          <form onSubmit={submit} className="login-form">
            <div className="login-heading"><h2>欢迎回来</h2><p>登录后查看或管理护士组排班</p></div>
            {error && <Notice tone="warning" title={error} />}
            <Field label="登录账号">
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus placeholder="请输入登录账号" />
            </Field>
            <Field label="密码">
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="请输入密码" />
            </Field>
            <Button variant="primary" type="submit" disabled={loading || !username || !password}>{loading ? '正在登录…' : '登录系统'}</Button>
            <p className="login-help">普通账户由超级用户统一创建，无需注册。</p>
          </form>
        </section>
      </div>
    </main>
  )
}

function navFor(user) {
  if (user.role === 'super') return [
    ['/', '概览', LayoutDashboard], ['/schedules', '月度排班', CalendarDays], ['/groups', '护士组', UsersRound],
    ['/accounts', '账户管理', CircleUserRound], ['/logs', '操作日志', FileClock], ['/system', '系统状态', Activity],
    ['/profile', '修改密码', KeyRound],
  ]
  if (user.canManageSchedule) return [
    ['/', '概览', LayoutDashboard], ['/schedules', '本组排班', CalendarDays], [`/groups/${user.groupId}`, '成员与规则', UsersRound],
    ['/logs', '操作日志', FileClock], ['/profile', '个人设置', Settings],
  ]
  return [['/schedules', '本组排班', CalendarDays], ['/profile', '个人设置', Settings]]
}

function Shell({ user, onLogout, children }) {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  useEffect(() => {
    if (user.role === 'super') api('/api/system').then((data) => setNotifications(data.notifications.filter((item) => !item.readAt))).catch(() => {})
  }, [location.pathname, user.role])
  const nav = navFor(user)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand"><span className="brand-mark"><CalendarDays size={18} /></span><span>护士排班</span></div>
        <nav className="sidebar-nav">
          {nav.map(([href, label, Icon]) => {
            const active = href === '/' ? location.pathname === '/' : location.pathname.startsWith(href)
            return <Link key={href} to={href} className={active ? 'nav-active' : ''} onClick={() => setMobileOpen(false)}><Icon size={17} />{label}</Link>
          })}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <div><strong>{user.name}</strong><span>{user.role === 'super' ? '超级用户' : user.groupName || '未分组'}</span></div>
          <button className="icon-button" onClick={onLogout} title="退出登录"><LogOut size={17} /></button>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} />}
      <div className="app-main">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <span>护士排班</span>
          <div className="avatar avatar-small">{user.name.slice(0, 1)}</div>
        </header>
        {notifications.length > 0 && (
          <div className="global-alert"><AlertTriangle size={16} /><span>有 {notifications.length} 条系统异常需要处理</span><Link to="/system">查看</Link></div>
        )}
        <div className="page-wrap">{children}</div>
      </div>
    </div>
  )
}

function PageHeader({ eyebrow, title, description, actions }) {
  return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
}

function DashboardPage({ user }) {
  const navigate = useNavigate()
  const { loading, data, error, reload } = useAsync(() => api('/api/dashboard'), [user.id])
  if (loading) return <Spinner />
  if (error) return <EmptyState icon={AlertTriangle} title="概览加载失败" description={error} action={<Button onClick={reload}>重试</Button>} />
  const generated = data.schedules.filter((item) => item.generated).length
  return (
    <>
      <PageHeader eyebrow="TODAY" title={`你好，${user.name}`} description="这里是护士组与本月排班的最新状态。" />
      <div className="stat-grid">
        <article className="stat-card"><span className="stat-icon"><UsersRound size={18} /></span><div><strong>{data.activeUsers}</strong><span>启用护士账户</span></div></article>
        <article className="stat-card"><span className="stat-icon"><CalendarDays size={18} /></span><div><strong>{generated}/{data.schedules.length}</strong><span>本月已排班组</span></div></article>
        <article className="stat-card"><span className="stat-icon"><ShieldCheck size={18} /></span><div><strong>{data.groupCount}</strong><span>可查看护士组</span></div></article>
      </div>
      <section className="panel">
        <div className="panel-heading"><div><h2>本月排班状态</h2><p>{data.current.year} 年 {data.current.month} 月</p></div><Button icon={CalendarDays} onClick={() => navigate('/schedules')}>查看排班</Button></div>
        {data.schedules.length ? <div className="status-list">{data.schedules.map((group) => (
          <div className="status-row" key={group.id}><span className={`status-dot ${group.generated ? 'status-ok' : 'status-muted'}`} /><div><strong>{group.name}</strong><span>{group.generated ? '当月排班已生成' : '当月排班尚未生成'}</span></div><Badge tone={group.generated ? 'success' : 'warning'}>{group.generated ? '已完成' : '待处理'}</Badge></div>
        ))}</div> : <EmptyState icon={UsersRound} title="还没有护士组" description={user.role === 'super' ? '先创建护士组，再添加护士账户。' : '请联系超级用户完成分组。'} />}
      </section>
    </>
  )
}

function SchedulePage({ user }) {
  const dialogs = useDialog()
  const [groups, setGroups] = useState([])
  const [groupId, setGroupId] = useState(user.groupId || '')
  const today = getShanghaiToday()
  const [todayYear, todayMonth] = today.split('-').map(Number)
  const [selectedMonth, setSelectedMonth] = useState(monthValue(todayYear, todayMonth))
  const [schedule, setSchedule] = useState(null)
  const [scheduleMonths, setScheduleMonths] = useState([])
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [memberModal, setMemberModal] = useState(false)
  const [availableMembers, setAvailableMembers] = useState([])
  const navigate = useNavigate()

  const canManage = user.role === 'super' || (user.canManageSchedule && Number(user.groupId) === Number(groupId))
  const [year, month] = selectedMonth.split('-').map(Number)
  const next = nextMonth(todayYear, todayMonth)
  const isAllowedManual = selectedMonth === monthValue(todayYear, todayMonth) || selectedMonth === monthValue(next.year, next.month)

  const loadGroups = useCallback(async () => {
    const data = await api('/api/groups')
    const active = data.groups.filter((item) => !item.archived)
    setGroups(active)
    if (!groupId && active.length) setGroupId(active[0].id)
  }, [groupId])

  const loadSchedule = useCallback(async () => {
    if (!groupId) { setLoading(false); setSchedule(null); setMissing(true); return }
    setLoading(true); setError(''); setDraft({})
    try {
      const data = await api(`/api/schedules/${groupId}/${year}/${month}`)
      setSchedule(data.schedule); setMissing(false)
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.data?.missing) { setSchedule(null); setMissing(true) }
      else setError(requestError.message)
    } finally { setLoading(false) }
  }, [groupId, year, month])

  useEffect(() => { loadGroups().catch((requestError) => setError(requestError.message)) }, [loadGroups])
  useEffect(() => { loadSchedule() }, [loadSchedule])
  useEffect(() => {
    if (!groupId) { setScheduleMonths([]); return }
    api(`/api/schedules?groupId=${groupId}`).then((data) => setScheduleMonths(data.schedules)).catch(() => setScheduleMonths([]))
  }, [groupId, schedule?.id])

  const draftSchedule = useMemo(() => {
    if (!schedule) return null
    return { ...schedule, members: schedule.members.map((member) => ({
      ...member, entries: { ...member.entries, ...(draft[member.id] || {}) },
    })) }
  }, [schedule, draft])
  const warnings = useMemo(() => draftSchedule ? evaluateSchedule(draftSchedule) : [], [draftSchedule])
  const changeCount = Object.values(draft).reduce((sum, entries) => sum + Object.keys(entries).length, 0)

  function toggleCell(member, date) {
    if (!canManage || schedule.readOnly || !member.entries[date]) return
    const current = draft[member.id]?.[date] || member.entries[date]
    const next = current === 'rest' ? 'day' : 'rest'
    setDraft((value) => {
      const memberDraft = { ...(value[member.id] || {}) }
      if (next === member.entries[date]) delete memberDraft[date]
      else memberDraft[date] = next
      const result = { ...value }
      if (Object.keys(memberDraft).length) result[member.id] = memberDraft
      else delete result[member.id]
      return result
    })
  }

  async function saveChanges() {
    if (warnings.length && !await dialogs.confirm(`当前排班有 ${warnings.length} 条规则提示，仍要保存吗？`, { title: '排班规则提示', confirmText: '仍要保存', tone: 'warning' })) return
    const changes = Object.entries(draft).flatMap(([memberId, entries]) => Object.entries(entries).map(([date, status]) => ({ memberId: Number(memberId), date, status })))
    setSaving(true)
    try {
      const data = await api(`/api/schedules/${schedule.id}/entries`, { method: 'PATCH', body: { version: schedule.version, changes } })
      setSchedule(data.schedule); setDraft({})
    } catch (requestError) { await dialogs.alert(requestError.message, { title: '保存失败', tone: 'warning' }) } finally { setSaving(false) }
  }

  async function generate() {
    try {
      const data = await api('/api/schedules', { method: 'POST', body: { groupId: Number(groupId), year, month } })
      setSchedule(data.schedule); setMissing(false)
    } catch (requestError) { await dialogs.alert(requestError.message, { title: '生成失败', tone: 'warning' }) }
  }

  async function removeSchedule() {
    if (!await dialogs.confirm(`确认删除 ${year} 年 ${month} 月整份排班吗？删除后才能重新一键排班。`, { title: '删除整月排班', confirmText: '继续', tone: 'danger' })) return
    if (!await dialogs.confirm('所有手工调整都会被删除，但操作日志仍会保留。', { title: '再次确认删除', confirmText: '确认删除', tone: 'danger' })) return
    try { await api(`/api/schedules/${schedule.id}`, { method: 'DELETE' }); setSchedule(null); setMissing(true) }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '删除失败', tone: 'warning' }) }
  }

  async function openAddMember() {
    try {
      const data = await api('/api/users')
      setAvailableMembers(data.users.filter((item) => Number(item.groupId) === Number(groupId) && !schedule.members.some((member) => member.userId === item.id)))
      setMemberModal(true)
    } catch (requestError) { await dialogs.alert(requestError.message, { title: '加载失败', tone: 'warning' }) }
  }

  async function addMember(userId) {
    try {
      const data = await api(`/api/schedules/${schedule.id}/members`, { method: 'POST', body: { userId } })
      setSchedule(data.schedule); setMemberModal(false)
    } catch (requestError) { await dialogs.alert(requestError.message, { title: '添加失败', tone: 'warning' }) }
  }

  async function endMember(member) {
    const departureDate = await dialogs.prompt(`${member.name} 将从所选日期起不再参与本月排班。`, { title: '结束本月排班', label: '离组日期', inputType: 'date', defaultValue: today, confirmText: '确认结束' })
    if (!departureDate) return
    try {
      const data = await api(`/api/schedule-members/${member.id}/end`, { method: 'PATCH', body: { departureDate } })
      setSchedule(data.schedule)
    } catch (requestError) { await dialogs.alert(requestError.message, { title: '操作失败', tone: 'warning' }) }
  }

  async function exportExcel() {
    const writeExcelFile = (await import('write-excel-file/browser')).default
    const dates = listDates(schedule.periodStart, schedule.periodEnd)
    const nameCounts = schedule.members.reduce((map, member) => map.set(member.name, (map.get(member.name) || 0) + 1), new Map())
    const columnCount = dates.length + 2
    const rows = [
      [{
        value: `${schedule.groupName} ${schedule.year} 年 ${schedule.month} 月排班`,
        columnSpan: columnCount,
        fontSize: 16,
        fontWeight: 'bold',
        textColor: '#173f36',
        height: 28,
        alignVertical: 'center',
      }, ...Array(columnCount - 1).fill(null)],
      ['护士', ...dates.map((date) => `${Number(date.slice(-2))}日 周${weekdayLabels[weekday(date)]}`), '休息合计'].map((value) => ({
        value, fontWeight: 'bold', backgroundColor: '#e8efea', align: 'center', borderColor: '#dde1dc', borderStyle: 'thin',
      })),
      ...draftSchedule.members.map((member) => {
        const displayName = nameCounts.get(member.name) > 1 ? `${member.name}（${member.username}）` : member.name
        const restCount = Object.values(member.entries).filter((status) => status === 'rest').length
        return [
          { value: displayName, fontWeight: 'bold', borderColor: '#dde1dc', borderStyle: 'thin' },
          ...dates.map((date) => ({
            value: member.entries[date] ? (member.entries[date] === 'rest' ? '休息' : '长白班') : '',
            align: 'center',
            backgroundColor: member.entries[date] === 'rest' ? '#dcebe3' : !isWorkday(date) ? '#f2f3f1' : undefined,
            textColor: member.entries[date] === 'rest' ? '#246045' : '#555b56',
            borderColor: '#dde1dc', borderStyle: 'thin',
          })),
          { value: restCount, align: 'center', fontWeight: 'bold', borderColor: '#dde1dc', borderStyle: 'thin' },
        ]
      }),
      [],
      [{ value: '规则提示', fontWeight: 'bold', textColor: '#94620a' }],
      ...warnings.map((warning) => [{ value: warning.message, columnSpan: columnCount, textColor: '#79520a' }, ...Array(columnCount - 1).fill(null)]),
    ]
    await writeExcelFile(rows, {
      sheet: '月度排班',
      columns: [{ width: 20 }, ...dates.map(() => ({ width: 12 })), { width: 11 }],
      stickyRowsCount: 2,
      stickyColumnsCount: 1,
      orientation: 'landscape',
    }, { fontFamily: 'Noto Sans SC', fontSize: 11 }).toFile(
      `${schedule.groupName}-${schedule.year}年${String(schedule.month).padStart(2, '0')}月排班.xlsx`,
    )
  }

  const monthOptions = useMemo(() => {
    const optionMap = new Map()
    for (const item of scheduleMonths) optionMap.set(monthValue(item.year, item.month), { year: item.year, month: item.month })
    for (let offset = -12; offset <= 1; offset += 1) {
      const date = new Date(Date.UTC(todayYear, todayMonth - 1 + offset, 1))
      const item = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
      optionMap.set(monthValue(item.year, item.month), item)
    }
    return [...optionMap.values()].sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))
  }, [todayYear, todayMonth, scheduleMonths])

  return (
    <>
      <PageHeader eyebrow="MONTHLY ROSTER" title="月度排班" description="按护士组查看、生成和调整长白班排班。" actions={<>
        {user.role === 'super' && <select className="compact-select" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">选择护士组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
        <select className="compact-select" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>{monthOptions.map((item) => <option key={monthValue(item.year, item.month)} value={monthValue(item.year, item.month)}>{item.year} 年 {item.month} 月</option>)}</select>
      </>} />
      {!groups.length && !loading ? <EmptyState icon={UsersRound} title="没有可用护士组" description={user.role === 'super' ? '请先创建护士组并添加成员。' : '请联系超级用户将你的账户分入护士组。'} action={user.role === 'super' && <Button variant="primary" icon={Plus} onClick={() => navigate('/groups')}>创建护士组</Button>} /> : loading ? <Spinner label="正在读取排班" /> : error ? <EmptyState icon={AlertTriangle} title="排班加载失败" description={error} action={<Button onClick={loadSchedule}>重试</Button>} /> : missing ? (
        <EmptyState icon={CalendarDays} title={`${year} 年 ${month} 月尚无排班`} description={canManage ? (isAllowedManual ? '可以按当前成员和规则生成本月排班。' : '只能手工生成当前月和下一个月排班。') : '排班尚未生成，请稍后查看。'} action={canManage && isAllowedManual && <Button variant="primary" icon={CalendarDays} onClick={generate}>一键排班</Button>} />
      ) : (
        <>
          <section className="schedule-toolbar">
            <div className="schedule-meta"><Badge tone={schedule.readOnly ? 'neutral' : 'success'}>{schedule.readOnly ? '历史只读' : '可调整'}</Badge><span>{schedule.periodStart} 至 {schedule.periodEnd}</span><span>每日目标 {schedule.rules.dailyRestTarget} 人 · 每人月休 {schedule.rules.monthlyRestDays} 天</span></div>
            <div className="toolbar-actions">
              {canManage && !schedule.readOnly && schedule.year === todayYear && schedule.month === todayMonth && <Button icon={UserPlus} onClick={openAddMember}>添加本月成员</Button>}
              <Button icon={Download} onClick={exportExcel}>导出 Excel</Button>
              {canManage && !schedule.readOnly && isAllowedManual && <Button className="schedule-delete-button" variant="danger-ghost" icon={Trash2} onClick={removeSchedule}>删除排班</Button>}
            </div>
          </section>
          <ScheduleTable schedule={draftSchedule} draft={draft} canEdit={canManage && !schedule.readOnly} today={today} onToggle={toggleCell} onEndMember={schedule.year === todayYear && schedule.month === todayMonth ? endMember : null} />
          {changeCount > 0 && <div className="save-bar"><div><strong>{changeCount} 项修改尚未保存</strong><span>规则提示已实时更新</span></div><Button onClick={() => setDraft({})}>撤销</Button><Button variant="primary" icon={Save} onClick={saveChanges} disabled={saving}>{saving ? '保存中…' : '保存修改'}</Button></div>}
          <section className="warning-panel">
            <div className="panel-heading"><div><h2>规则提示</h2><p>提示不会阻止手工保存</p></div><Badge tone={warnings.length ? 'warning' : 'success'}>{warnings.length ? `${warnings.length} 条` : '全部符合'}</Badge></div>
            {warnings.length ? <ul className="warning-list">{warnings.map((warning, index) => <li key={`${warning.code}-${warning.date}-${warning.userId}-${index}`}><AlertTriangle size={15} />{warning.message}</li>)}</ul> : <div className="all-clear"><Check size={18} />当前排班符合全部规则。</div>}
          </section>
        </>
      )}
      {memberModal && <Modal title="添加到本月排班" description="新成员将从入组当天开始，初始均为长白班。" onClose={() => setMemberModal(false)}>{availableMembers.length ? <div className="picker-list">{availableMembers.map((member) => <button key={member.id} onClick={() => addMember(member.id)}><div className="avatar avatar-small">{member.name.slice(0, 1)}</div><span><strong>{member.name}</strong><small>{member.username}</small></span><Plus size={17} /></button>)}</div> : <EmptyState icon={UsersRound} title="没有可添加成员" description="本组所有启用成员都已在班表中。" />}</Modal>}
    </>
  )
}

function ScheduleTable({ schedule, draft, canEdit, today, onToggle, onEndMember }) {
  const dates = listDates(schedule.periodStart, schedule.periodEnd)
  const counts = schedule.members.reduce((map, member) => map.set(member.name, (map.get(member.name) || 0) + 1), new Map())
  return <div className="schedule-table-shell"><table className="schedule-table"><thead><tr><th className="sticky-name">护士</th>{dates.map((date) => <th key={date} className={`${!isWorkday(date) ? 'weekend' : ''} ${date === today ? 'today' : ''}`}><strong>{Number(date.slice(-2))}</strong><span>周{weekdayLabels[weekday(date)]}</span></th>)}<th className="sticky-total">休息</th>{onEndMember && canEdit && <th>操作</th>}</tr></thead><tbody>{schedule.members.map((member) => {
    const displayName = counts.get(member.name) > 1 ? `${member.name}（${member.username}）` : member.name
    const restCount = Object.values(member.entries).filter((status) => status === 'rest').length
    const expected = expectedRestDays(schedule.rules.monthlyRestDays, member.periodStart, member.periodEnd, schedule.year, schedule.month)
    return <tr key={member.id}><th className="sticky-name"><div className="nurse-cell"><span>{displayName}</span>{member.userId == null && <Badge>历史</Badge>}</div></th>{dates.map((date) => {
      const status = member.entries[date]
      const changed = Boolean(draft[member.id]?.[date])
      return <td key={date} className={`${!isWorkday(date) ? 'weekend' : ''} ${date === today ? 'today' : ''} ${changed ? 'cell-changed' : ''}`}><button disabled={!canEdit || !status} className={`shift-cell ${status ? `shift-${status}` : 'shift-empty'}`} onClick={() => onToggle(member, date)} title={status ? `${member.name} · ${date} · ${status === 'rest' ? '休息' : '长白班'}` : '不在排班区间'}>{status === 'rest' ? '休' : status === 'day' ? '班' : '—'}</button></td>
    })}<td className="sticky-total"><span className={restCount === expected ? 'rest-total-ok' : 'rest-total-warn'}>{restCount}<small>/{expected}</small></span></td>{onEndMember && canEdit && <td><button className="table-action" onClick={() => onEndMember(member)}>结束</button></td>}</tr>
  })}</tbody></table></div>
}

function GroupsPage({ user }) {
  const dialogs = useDialog()
  const navigate = useNavigate()
  const { loading, data, error, reload } = useAsync(() => api('/api/groups'), [user.id])
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  async function createGroup() {
    try { await api('/api/groups', { method: 'POST', body: { name } }); setCreateOpen(false); setName(''); reload() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '创建失败', tone: 'warning' }) }
  }
  async function toggleArchive(group) {
    const action = group.archived ? '恢复' : '归档'
    if (!await dialogs.confirm(`确认${action}护士组“${group.name}”吗？`, { title: `${action}护士组`, confirmText: `确认${action}`, tone: group.archived ? 'default' : 'warning' })) return
    try { await api(`/api/groups/${group.id}`, { method: 'PATCH', body: { archived: !group.archived } }); reload() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: `${action}失败`, tone: 'warning' }) }
  }
  async function deleteGroup(group) {
    if (!await dialogs.confirm(`永久删除空护士组“${group.name}”吗？此操作不可撤销。`, { title: '删除护士组', confirmText: '确认删除', tone: 'danger' })) return
    try { await api(`/api/groups/${group.id}`, { method: 'DELETE' }); reload() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '删除失败', tone: 'warning' }) }
  }
  if (loading) return <Spinner />
  return <><PageHeader eyebrow="TEAMS" title="护士组" description="管理排班主体、成员和组级规则。" actions={user.role === 'super' && <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>新建护士组</Button>} />{error ? <Notice tone="warning" title={error} action={<Button onClick={reload}>重试</Button>} /> : data.groups.length ? <div className="group-grid">{data.groups.map((group) => <article key={group.id} className={`group-card ${group.archived ? 'group-archived' : ''}`}><div className="group-card-top"><span className="group-monogram">{group.name.slice(0, 1)}</span><Badge tone={group.archived ? 'neutral' : 'success'}>{group.archived ? '已归档' : '使用中'}</Badge></div><div><h2>{group.name}</h2><p>{group.memberCount} 名护士 · {group.managerCount ? `${group.managerCount} 名排班管理员` : '仅超级用户管理'}</p></div><div className="rule-summary"><span><strong>{group.dailyRestTarget}</strong> 人/工作日</span><span><strong>{group.monthlyRestDays}</strong> 天/月休</span></div><div className="card-actions"><Button icon={Settings} onClick={() => navigate(`/groups/${group.id}`)}>管理</Button>{user.role === 'super' && <><Button icon={group.archived ? RefreshCw : Archive} onClick={() => toggleArchive(group)}>{group.archived ? '恢复' : '归档'}</Button>{!group.memberCount && !group.archived && <Button variant="danger-ghost" icon={Trash2} onClick={() => deleteGroup(group)}>删除</Button>}</>}</div></article>)}</div> : <EmptyState icon={UsersRound} title="还没有护士组" description="创建第一个护士组后，再分配护士账户。" action={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>新建护士组</Button>} />}{createOpen && <Modal title="新建护士组" description="新组默认工作日每天休息 1 人、每人月休 4 天。" onClose={() => setCreateOpen(false)} footer={<><Button onClick={() => setCreateOpen(false)}>取消</Button><Button variant="primary" onClick={createGroup} disabled={!name.trim()}>创建</Button></>}><Field label="护士组名称"><input value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder="例如：内科一组" maxLength={40} /></Field></Modal>}</>
}

function GroupDetailPage({ user }) {
  const dialogs = useDialog()
  const { id } = useParams()
  const navigate = useNavigate()
  const [group, setGroup] = useState(null)
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [ruleForm, setRuleForm] = useState({ dailyRestTarget: 1, monthlyRestDays: 4 })
  const [addOpen, setAddOpen] = useState(false)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [groupsData, usersData] = await Promise.all([api('/api/groups'), api('/api/users')])
      const selected = groupsData.groups.find((item) => item.id === Number(id))
      if (!selected) throw new Error('护士组不存在或无权查看')
      setGroup(selected); setRuleForm({ dailyRestTarget: selected.dailyRestTarget, monthlyRestDays: selected.monthlyRestDays }); setUsers(usersData.users)
    } catch (requestError) { setError(requestError.message) } finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])
  async function saveRules() {
    try { await api(`/api/groups/${id}`, { method: 'PATCH', body: ruleForm }); load() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '保存失败', tone: 'warning' }) }
  }
  async function add(userId) {
    try { await api(`/api/groups/${id}/members/${userId}`, { method: 'POST' }); setAddOpen(false); load() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '添加失败', tone: 'warning' }) }
  }
  async function remove(member) {
    if (!await dialogs.confirm(`将“${member.name}”移出本组吗？已有排班不会自动改变。`, { title: '移出护士组', confirmText: '确认移出', tone: 'warning' })) return
    try { await api(`/api/groups/${id}/members/${member.id}`, { method: 'DELETE' }); load() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '移出失败', tone: 'warning' }) }
  }
  if (loading) return <Spinner />
  if (error) return <EmptyState icon={AlertTriangle} title="无法打开护士组" description={error} action={<Button icon={ArrowLeft} onClick={() => navigate('/groups')}>返回</Button>} />
  const members = users.filter((item) => Number(item.groupId) === Number(id))
  const available = users.filter((item) => item.groupId == null && item.active && (!item.canManageSchedule || user.role === 'super'))
  return <><PageHeader eyebrow="TEAM SETTINGS" title={group.name} description={`${members.length} 名护士 · ${group.managerCount || 0} 名排班管理员`} actions={<Button icon={ArrowLeft} onClick={() => navigate('/groups')}>返回护士组</Button>} /><div className="settings-grid"><section className="panel"><div className="panel-heading"><div><h2>排班规则</h2><p>规则修改不会自动改变已有班次</p></div></div><div className="rule-form"><Field label="每日休息人数" hint={`当前组最多可设置 ${members.length} 人`}><div className="number-input"><input type="number" min="0" max={members.length} value={ruleForm.dailyRestTarget} onChange={(event) => setRuleForm((value) => ({ ...value, dailyRestTarget: Number(event.target.value) }))} /><span>人 / 工作日</span></div></Field><Field label="每人月休天数"><div className="number-input"><input type="number" min="0" max="31" value={ruleForm.monthlyRestDays} onChange={(event) => setRuleForm((value) => ({ ...value, monthlyRestDays: Number(event.target.value) }))} /><span>天 / 月</span></div></Field><Button variant="primary" icon={Save} onClick={saveRules}>保存规则</Button></div></section><section className="panel"><div className="panel-heading"><div><h2>组内成员</h2><p>成员变化不会自动改写已有排班</p></div><Button icon={UserPlus} onClick={() => setAddOpen(true)}>添加成员</Button></div>{members.length ? <div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><div className="avatar avatar-small">{member.name.slice(0, 1)}</div><div><strong>{member.name}</strong><span>{member.username}</span></div>{member.canManageSchedule ? <Badge tone="accent">排班管理员</Badge> : <Badge>普通护士</Badge>}<button className="icon-button danger" disabled={member.id === user.id || (member.canManageSchedule && user.role !== 'super')} onClick={() => remove(member)} title="移出本组"><UserMinus size={17} /></button></div>)}</div> : <EmptyState icon={UsersRound} title="组内暂无成员" description="从未分组账户中添加护士。" />}</section></div>{addOpen && <Modal title="添加组员" description="只能添加未分组账户；跨组转移由超级用户在账户管理中完成。" onClose={() => setAddOpen(false)}>{available.length ? <div className="picker-list">{available.map((member) => <button key={member.id} onClick={() => add(member.id)}><div className="avatar avatar-small">{member.name.slice(0, 1)}</div><span><strong>{member.name}</strong><small>{member.username}</small></span><Plus size={17} /></button>)}</div> : <EmptyState icon={CircleUserRound} title="没有可添加账户" description="请先由超级用户创建账户，或移出其他组。" />}</Modal>}</>
}

function AccountsPage() {
  const dialogs = useDialog()
  const { loading, data, error, reload } = useAsync(async () => {
    const [users, groups] = await Promise.all([api('/api/users'), api('/api/groups')])
    return { users: users.users, groups: groups.groups.filter((group) => !group.archived) }
  }, [])
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [createForm, setCreateForm] = useState({ username: '', name: '' })
  const [editForm, setEditForm] = useState(null)
  async function create() {
    try { await api('/api/users', { method: 'POST', body: createForm }); setCreateOpen(false); setCreateForm({ username: '', name: '' }); await dialogs.alert('账户已创建，默认初始密码为 123456。', { title: '创建成功', tone: 'success' }); reload() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '创建失败', tone: 'warning' }) }
  }
  function openEdit(user) {
    setEditing(user); setEditForm({ name: user.name, groupId: user.groupId || '', canManageSchedule: user.canManageSchedule, active: user.active })
  }
  async function saveEdit() {
    try { await api(`/api/users/${editing.id}`, { method: 'PATCH', body: { ...editForm, groupId: editForm.groupId ? Number(editForm.groupId) : null } }); setEditing(null); reload() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '保存失败', tone: 'warning' }) }
  }
  async function resetPassword(user) {
    if (!await dialogs.confirm(`将“${user.name}”的密码重置为 123456 吗？`, { title: '重置账户密码', confirmText: '确认重置', tone: 'warning' })) return
    try { await api(`/api/users/${user.id}/reset-password`, { method: 'POST' }); await dialogs.alert('密码已重置为 123456。', { title: '重置成功', tone: 'success' }); reload() }
    catch (requestError) { await dialogs.alert(requestError.message, { title: '重置失败', tone: 'warning' }) }
  }
  if (loading) return <Spinner />
  return <><PageHeader eyebrow="ACCOUNTS" title="账户管理" description="创建护士账户、分组并授予排班管理权限。" actions={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>新增账户</Button>} />{error ? <Notice tone="warning" title={error} /> : <section className="panel table-panel"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>护士</th><th>登录账号</th><th>所属护士组</th><th>权限</th><th>状态</th><th>密码</th><th /></tr></thead><tbody>{data.users.map((item) => <tr key={item.id}><td><div className="person-cell"><div className="avatar avatar-small">{item.name.slice(0, 1)}</div><strong>{item.name}</strong></div></td><td><code>{item.username}</code></td><td>{item.groupName || <span className="muted">未分组</span>}</td><td>{item.canManageSchedule ? <Badge tone="accent">排班管理员</Badge> : <Badge>普通护士</Badge>}</td><td><Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? '启用' : '停用'}</Badge></td><td>{item.usesDefaultPassword ? <Badge tone="warning">默认密码</Badge> : <span className="muted">已修改</span>}</td><td><div className="row-actions"><button className="icon-button" onClick={() => openEdit(item)} title="编辑"><PencilLine size={16} /></button><button className="icon-button" onClick={() => resetPassword(item)} title="重置密码"><KeyRound size={16} /></button></div></td></tr>)}</tbody></table></div></section>}{createOpen && <Modal title="新增普通账户" description="创建后默认密码为 123456，首次登录不强制修改。" onClose={() => setCreateOpen(false)} footer={<><Button onClick={() => setCreateOpen(false)}>取消</Button><Button variant="primary" onClick={create} disabled={!createForm.username || !createForm.name}>创建账户</Button></>}><div className="form-stack"><Field label="护士姓名"><input value={createForm.name} onChange={(event) => setCreateForm((value) => ({ ...value, name: event.target.value }))} placeholder="例如：王芳" /></Field><Field label="登录账号" hint="3–32 位字母、数字、点、横线或下划线；创建后不可修改"><input value={createForm.username} onChange={(event) => setCreateForm((value) => ({ ...value, username: event.target.value }))} placeholder="例如：wangfang" /></Field><Notice title="默认初始密码">123456</Notice></div></Modal>}{editing && <Modal title="编辑账户" description={`${editing.name}（${editing.username}）`} onClose={() => setEditing(null)} footer={<><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" onClick={saveEdit}>保存修改</Button></>}><div className="form-stack"><Field label="护士姓名"><input value={editForm.name} onChange={(event) => setEditForm((value) => ({ ...value, name: event.target.value }))} /></Field><Field label="所属护士组"><select value={editForm.groupId} onChange={(event) => setEditForm((value) => ({ ...value, groupId: event.target.value }))}><option value="">未分组</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field><label className="switch-row"><span><strong>排班管理权限</strong><small>由超级用户授权，可管理所在组成员、规则和排班</small></span><input type="checkbox" checked={editForm.canManageSchedule} onChange={(event) => setEditForm((value) => ({ ...value, canManageSchedule: event.target.checked }))} /></label><label className="switch-row"><span><strong>账户启用</strong><small>停用后不能登录，并自动移出护士组</small></span><input type="checkbox" checked={editForm.active} onChange={(event) => setEditForm((value) => ({ ...value, active: event.target.checked }))} /></label></div></Modal>}</>
}

function LogsPage({ user }) {
  const [page, setPage] = useState(1)
  const [groupId, setGroupId] = useState('')
  const [groups, setGroups] = useState([])
  const [expanded, setExpanded] = useState(null)
  useEffect(() => { if (user.role === 'super') api('/api/groups').then((data) => setGroups(data.groups)).catch(() => {}) }, [user.role])
  const { loading, data, error, reload } = useAsync(() => api(`/api/audit-logs?page=${page}&pageSize=30${groupId ? `&groupId=${groupId}` : ''}`), [page, groupId])
  return <><PageHeader eyebrow="AUDIT TRAIL" title="操作日志" description="所有新增、修改和删除记录永久保留。" actions={user.role === 'super' && <select className="compact-select" value={groupId} onChange={(event) => { setGroupId(event.target.value); setPage(1) }}><option value="">全部护士组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>} />{loading ? <Spinner /> : error ? <Notice tone="warning" title={error} action={<Button onClick={reload}>重试</Button>} /> : <section className="panel table-panel"><div className="data-table-wrap"><table className="data-table log-table"><thead><tr><th>时间</th><th>操作者</th><th>护士组</th><th>类型</th><th>摘要</th><th /></tr></thead><tbody>{data.logs.map((log) => <Fragment key={log.id}><tr><td>{formatChinaTime(log.createdAt)}</td><td><strong>{log.actorName}</strong><small>{log.actorUsername}</small></td><td>{log.groupName || '全局'}</td><td><Badge tone={log.action === 'delete' ? 'warning' : log.action === 'create' ? 'success' : 'accent'}>{actionLabels[log.action]}</Badge></td><td>{log.summary}</td><td><button className="icon-button" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>{expanded === log.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td></tr>{expanded === log.id && <tr className="log-detail"><td colSpan="6"><div><section><span>修改前</span><pre>{log.before ? JSON.stringify(log.before, null, 2) : '—'}</pre></section><section><span>修改后</span><pre>{log.after ? JSON.stringify(log.after, null, 2) : '—'}</pre></section></div></td></tr>}</Fragment>)}</tbody></table></div><div className="pagination"><span>共 {data.total} 条</span><Button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>上一页</Button><Badge>{page}</Badge><Button disabled={page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>下一页</Button></div></section>}</>
}

function SystemPage() {
  const { loading, data, error, reload } = useAsync(() => api('/api/system'), [])
  async function markRead(id) { await api(`/api/notifications/${id}/read`, { method: 'PATCH' }); reload() }
  if (loading) return <Spinner />
  return <><PageHeader eyebrow="SYSTEM" title="系统状态" description="自动排班与数据备份的运行情况。" actions={<Button icon={RefreshCw} onClick={reload}>刷新</Button>} />{error ? <Notice tone="warning" title={error} /> : <div className="system-grid"><section className="panel system-card"><span className="system-icon"><Archive size={21} /></span><div><span className="eyebrow">DATA BACKUP</span><h2>数据备份</h2>{data.backup ? <><Badge tone={data.backup.status === 'success' ? 'success' : 'warning'}>{data.backup.status === 'success' ? '最近备份成功' : '最近备份失败'}</Badge><p>{formatChinaTime(data.backup.createdAt)}</p>{data.backup.error && <small>{data.backup.error}</small>}</> : <p>尚无备份记录，系统将在计划时间自动执行。</p>}</div></section><section className="panel system-card"><span className="system-icon"><CalendarDays size={21} /></span><div><span className="eyebrow">AUTOMATION</span><h2>每月自动排班</h2><Badge tone="success">运行中</Badge><p>每月 1 日 00:05 执行，服务恢复时自动补偿。</p></div></section></div>}{data.notifications.length ? <section className="panel"><div className="panel-heading"><div><h2>异常提醒</h2><p>仅超级用户可见</p></div><Badge tone="warning">{data.notifications.length} 条</Badge></div><div className="notification-list">{data.notifications.map((item) => <div key={item.id}><AlertTriangle size={18} /><div><strong>{item.message}</strong><span>{formatChinaTime(item.createdAt)}</span></div>{!item.readAt && <Button onClick={() => markRead(item.id)}>标记已读</Button>}</div>)}</div></section> : <div className="all-clear system-clear"><Check size={18} />当前没有系统异常。</div>}</>
}

function ProfilePage({ user, onLoggedOut }) {
  const dialogs = useDialog()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event) {
    event.preventDefault(); setError('')
    if (form.newPassword !== form.confirmPassword) return setError('两次输入的新密码不一致')
    setSaving(true)
    try {
      const [encryptedCurrentPassword, encryptedNewPassword] = await Promise.all([
        encryptPassword(form.currentPassword),
        encryptPassword(form.newPassword),
      ])
      await api('/api/auth/change-password', { method: 'POST', body: { encryptedCurrentPassword, encryptedNewPassword } })
      await dialogs.alert('密码已修改，请重新登录。', { title: '修改成功', tone: 'success' })
      onLoggedOut()
    }
    catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }
  return <><PageHeader eyebrow="PROFILE" title="个人设置" description="查看账户信息并修改登录密码。" /><div className="profile-grid"><section className="panel profile-card"><div className="avatar avatar-large">{user.name.slice(0, 1)}</div><h2>{user.name}</h2><code>{user.username}</code><div className="profile-meta"><span>身份<strong>{user.role === 'super' ? '超级用户' : user.canManageSchedule ? '排班管理员' : '普通护士'}</strong></span><span>护士组<strong>{user.groupName || '未分组'}</strong></span></div></section><section className="panel"><div className="panel-heading"><div><h2>修改密码</h2><p>密码长度为 6–64 个字符</p></div><LockKeyhole size={20} /></div><form className="form-stack" onSubmit={submit}>{error && <Notice tone="warning" title={error} />}<Field label="当前密码"><input type="password" value={form.currentPassword} onChange={(event) => setForm((value) => ({ ...value, currentPassword: event.target.value }))} /></Field><Field label="新密码"><input type="password" value={form.newPassword} onChange={(event) => setForm((value) => ({ ...value, newPassword: event.target.value }))} /></Field><Field label="确认新密码"><input type="password" value={form.confirmPassword} onChange={(event) => setForm((value) => ({ ...value, confirmPassword: event.target.value }))} /></Field><Button type="submit" variant="primary" disabled={saving}>{saving ? '保存中…' : '修改密码'}</Button></form></section></div></>
}

function AppContent() {
  const [auth, setAuth] = useState({ loading: true, user: null })
  useEffect(() => { api('/api/auth/me').then((data) => setAuth({ loading: false, user: data.user })).catch(() => setAuth({ loading: false, user: null })) }, [])
  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch {}
    setAuth({ loading: false, user: null })
  }
  if (auth.loading) return <div className="app-boot"><span className="brand-mark brand-mark-large"><CalendarDays size={24} /></span><Spinner label="正在启动护士排班" /></div>
  if (!auth.user) return <LoginPage onLogin={(user) => setAuth({ loading: false, user })} />
  const user = auth.user
  return <Shell user={user} onLogout={logout}><Routes><Route path="/" element={user.role === 'super' || user.canManageSchedule ? <DashboardPage user={user} /> : <Navigate to="/schedules" replace />} /><Route path="/schedules" element={<SchedulePage user={user} />} /><Route path="/groups" element={user.role === 'super' ? <GroupsPage user={user} /> : <Navigate to={`/groups/${user.groupId}`} replace />} /><Route path="/groups/:id" element={user.role === 'super' || user.canManageSchedule ? <GroupDetailPage user={user} /> : <Navigate to="/schedules" replace />} /><Route path="/accounts" element={user.role === 'super' ? <AccountsPage /> : <Navigate to="/" replace />} /><Route path="/logs" element={user.role === 'super' || user.canManageSchedule ? <LogsPage user={user} /> : <Navigate to="/schedules" replace />} /><Route path="/system" element={user.role === 'super' ? <SystemPage /> : <Navigate to="/" replace />} /><Route path="/profile" element={<ProfilePage user={user} onLoggedOut={() => setAuth({ loading: false, user: null })} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Shell>
}

export default function App() {
  return <DialogProvider><AppContent /></DialogProvider>
}
