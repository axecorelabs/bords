# Bords Company Admin Dashboard

## Purpose
A company-level control center for operating Bords end-to-end: growth, reliability, billing, trust, and support.

## 1. Executive Overview
- Daily active users (DAU), weekly active users (WAU), monthly active users (MAU)
- New signups, activation rate, trial-to-paid conversion
- MRR, churn, expansion revenue
- Active workspaces, active boards, active collaborators
- System health snapshot: API uptime, websocket uptime, error rate, sync latency
- Open incidents and unresolved support tickets

## 2. User and Workspace Management
- Global user directory with filters (plan, region, status, role)
- Workspace directory (personal and organization)
- Admin actions: suspend/reactivate user, disable workspace, transfer ownership
- Admin notes and audit trail per user/workspace
- Invite abuse and spam detection queue

## 3. Subscription and Billing Operations
- Subscription status by workspace (trial, active, past_due, canceled)
- Revenue dashboards: MRR/ARR, refunds, failed payments
- Plan controls (upgrade/downgrade, coupon grants, credits)
- Payment failure retry queue and dunning health
- Invoice and transaction viewer for support team

## 4. Product Usage and Feature Adoption
- Most-used features: sticky notes, kanban, checklist, media, drawing, comments, calls
- Funnel views:
  1. Signup -> first board created
  2. First board -> first collaborator invited
  3. First collaborator -> recurring weekly activity
- Power-user and at-risk cohort segments
- Workspace engagement score (custom formula)

## 5. Real-Time and Sync Reliability
- Live websocket connections and disconnect spikes
- Yjs document sync latency and conflict/merge anomalies
- Board load times, large-board performance, API p95/p99 latency
- Background job health and queue depth
- Alerts for degradation thresholds

## 6. Moderation, Security, and Compliance
- Flagged content and abuse reports queue
- Login anomalies and suspicious IP/device behavior
- Permission escalation events and unusual admin actions
- Data export/delete request tracker
- Audit logs for sensitive actions (immutable and searchable)

## 7. Support and Success Console
- Unified timeline per user/workspace:
  1. Last login
  2. Last board activity
  3. Billing state
  4. Recent errors
- Fast actions: reset invite flow, trigger verification email, grant temporary access
- Support SLA board with ticket aging and priority routing
- In-app announcement and incident messaging controls

## 8. Internal Admin Controls
- Feature flags and staged rollout controls
- Kill switches for unstable modules
- Experiment management and A/B test readouts
- System announcements, maintenance mode, status banners
- Role-based admin permissions:
  1. Super Admin
  2. Support Admin
  3. Billing Admin
  4. Security Admin
  5. Read-only Analyst

## 9. Analytics and Reporting
- Scheduled reports (daily/weekly) to leadership
- Retention cohorts by signup month and plan
- Team productivity metrics across org workspaces
- Exportable CSV/BI hooks for finance and product teams
- Goal tracking against quarterly targets

## 10. Dashboard Design Rules
- Role-specific home views (CEO/CPO/Support/SRE/Billing)
- Drill-down path: KPI -> workspace -> user -> event log
- Real-time cards for critical incidents, cached views for heavy analytics
- Every metric should have an owner, definition, and source of truth
- Avoid vanity metrics; tie each panel to actionability

## MVP (Build First)
1. Executive Overview
2. User/Workspace Management
3. Billing Operations
4. Reliability Monitor
5. Audit Logs
6. Support Console (basic)

## Phase 2
1. Feature adoption funnels
2. Cohort retention analytics
3. Advanced security risk scoring
4. Experiment and feature-flag analytics
