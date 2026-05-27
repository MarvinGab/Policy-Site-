// The default module + policy structure every new organization starts with.
// Each org's super admin / org admin can then add / rename / delete from here.
export const ORG_TEMPLATE = [
  {
    name: "Doing the Right Thing",
    slug: "doing-the-right-thing",
    description: "Ethics, fair practices, and responsible conduct.",
    policies: [
      "POSH Policy (Sexual Harassment)",
      "Equal Employment Opportunity Policy",
      "PIT (Prevention of Insider Trading)",
      "Employment of Relatives & Marriage within the Company",
      "Code of Conduct",
      "Whistleblower Policy",
      "Conflict of Interest Policy",
    ],
  },
  {
    name: "Health, Care & Safety",
    slug: "health-care-safety",
    description: "Safety guidelines and employee care coverage.",
    policies: [
      "Maternity Benefit Act / Policy",
      "Workplace Safety Guidelines / Fire & Safety",
      "Mediclaim, Life Insurance, Personal Accident",
    ],
  },
  {
    name: "Learning & Performance",
    slug: "learning-performance",
    description: "Growth, development, and performance alignment.",
    policies: [
      "Training & Development Policy",
      "Performance Management Policy",
    ],
  },
  {
    name: "Life at Work",
    slug: "life-at-work",
    description: "Employment standards and on-the-job guidance.",
    policies: [
      "Contract Labour (R&A) Act",
      "Recruitment and On-Boarding",
      "Employment Guidelines",
      "Internship / Trainee Engagement Guidelines",
    ],
  },
  {
    name: "Pay, Perks & Security",
    slug: "pay-perks-security",
    description: "Compensation, benefits, and statutory obligations.",
    policies: [
      "Gratuity Policy / Provisioning",
      "Minimum Wages Compliance / Act",
      "Compensation & Benefits Policy",
      "Employee Loan Policy",
      "Salary Administration",
      "LTA",
      "National Pension Scheme (NPS)",
    ],
  },
  {
    name: "Time Away",
    slug: "time-away",
    description: "Leave planning, holiday schedules, and attendance.",
    policies: ["Holidays, Leave & Attendance"],
  },
  {
    name: "Tools & Allowance",
    slug: "tools-allowance",
    description: "Reimbursements for work-related tools and expenses.",
    policies: ["Books & Periodicals", "Internet & Telephone", "Car / Fuel"],
  },
];
