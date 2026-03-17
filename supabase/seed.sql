-- Seed plan data (prices in NGN, matching existing MongoDB data)

INSERT INTO plans (name, slug, description, price, currency, interval, features, max_boards, max_tasks_per_board, max_collaborators, is_active, sort_order)
VALUES
  (
    'Free', 'free',
    'Perfect for getting started with visual productivity',
    0, 'NGN', 'monthly',
    ARRAY['Up to 3 boards', 'Up to 50 tasks per board', 'Basic sticky notes', 'Task management', 'Mobile responsive'],
    3, 50, 0, TRUE, 0
  ),
  (
    'Pro', 'pro',
    'For individuals who need more power and flexibility',
    5000, 'NGN', 'monthly',
    ARRAY['Unlimited boards', 'Unlimited tasks', 'Advanced connections', 'Priority support', 'Export capabilities', 'Custom themes', 'Up to 5 collaborators'],
    -1, -1, 5, TRUE, 1
  ),
  (
    'Pro Yearly', 'pro-yearly',
    'Pro plan billed annually - Save 20%',
    48000, 'NGN', 'yearly',
    ARRAY['Unlimited boards', 'Unlimited tasks', 'Advanced connections', 'Priority support', 'Export capabilities', 'Custom themes', 'Up to 5 collaborators', '2 months free'],
    -1, -1, 5, TRUE, 2
  ),
  (
    'Team', 'team',
    'For teams that collaborate on projects',
    15000, 'NGN', 'monthly',
    ARRAY['Everything in Pro', 'Unlimited collaborators', 'Team workspaces', 'Advanced permissions', 'Real-time collaboration', 'Team analytics', 'Dedicated support'],
    -1, -1, -1, TRUE, 3
  ),
  (
    'Team Yearly', 'team-yearly',
    'Team plan billed annually - Save 20%',
    144000, 'NGN', 'yearly',
    ARRAY['Everything in Pro', 'Unlimited collaborators', 'Team workspaces', 'Advanced permissions', 'Real-time collaboration', 'Team analytics', 'Dedicated support', '2 months free'],
    -1, -1, -1, TRUE, 4
  )
ON CONFLICT (slug) DO NOTHING;
