import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const plans = [
  {
    name: 'Free',
    slug: 'free',
    description: 'Perfect for getting started with visual productivity',
    price: 0,
    currency: 'NGN',
    interval: 'monthly',
    features: [
      'Up to 3 boards',
      'Up to 50 tasks per board',
      'Basic sticky notes',
      'Task management',
      'Mobile responsive',
    ],
    max_boards: 3,
    max_tasks_per_board: 50,
    max_collaborators: 0,
    is_active: true,
  },
  {
    name: 'Pro',
    slug: 'pro',
    description: 'For individuals who need more power and flexibility',
    price: 5000,
    currency: 'NGN',
    interval: 'monthly',
    features: [
      'Unlimited boards',
      'Unlimited tasks',
      'Advanced connections',
      'Priority support',
      'Export capabilities',
      'Custom themes',
      'Up to 5 collaborators',
    ],
    max_boards: -1,
    max_tasks_per_board: -1,
    max_collaborators: 5,
    is_active: true,
  },
  {
    name: 'Pro Yearly',
    slug: 'pro-yearly',
    description: 'Pro plan billed annually - Save 20%',
    price: 48000,
    currency: 'NGN',
    interval: 'yearly',
    features: [
      'Unlimited boards',
      'Unlimited tasks',
      'Advanced connections',
      'Priority support',
      'Export capabilities',
      'Custom themes',
      'Up to 5 collaborators',
      '2 months free',
    ],
    max_boards: -1,
    max_tasks_per_board: -1,
    max_collaborators: 5,
    is_active: true,
  },
  {
    name: 'Team',
    slug: 'team',
    description: 'For teams that collaborate on projects',
    price: 15000,
    currency: 'NGN',
    interval: 'monthly',
    features: [
      'Everything in Pro',
      'Unlimited collaborators',
      'Team workspaces',
      'Advanced permissions',
      'Real-time collaboration',
      'Team analytics',
      'Dedicated support',
    ],
    max_boards: -1,
    max_tasks_per_board: -1,
    max_collaborators: -1,
    is_active: true,
  },
  {
    name: 'Team Yearly',
    slug: 'team-yearly',
    description: 'Team plan billed annually - Save 20%',
    price: 144000,
    currency: 'NGN',
    interval: 'yearly',
    features: [
      'Everything in Pro',
      'Unlimited collaborators',
      'Team workspaces',
      'Advanced permissions',
      'Real-time collaboration',
      'Team analytics',
      'Dedicated support',
      '2 months free',
    ],
    max_boards: -1,
    max_tasks_per_board: -1,
    max_collaborators: -1,
    is_active: true,
  },
]

async function seedPlans() {
  try {
    console.log('Clearing existing plans...')
    const { error: deleteError } = await supabase.from('plans').delete().neq('id', '')
    if (deleteError) throw deleteError

    console.log('Creating plans...')
    const { data: createdPlans, error } = await supabase
      .from('plans')
      .insert(plans)
      .select()
    if (error) throw error

    console.log(`✅ Successfully created ${createdPlans.length} plans:`)
    createdPlans.forEach((plan) => {
      console.log(`  - ${plan.name} (${plan.slug}): ${plan.currency} ${plan.price}/${plan.interval}`)
    })

    console.log('\n✅ Database seeded successfully!')
    process.exit(0)
  } catch (error) {
    console.error('❌ Error seeding database:', error)
    process.exit(1)
  }
}

seedPlans()
