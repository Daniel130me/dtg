/**
 * Static marketing content for the public pages.
 *
 * This module intentionally holds FIXED marketing copy (instructor profile,
 * student testimonials, footer category links) that does not belong to any
 * runtime API: it replaced the last prototype mock-data imports on the
 * public/about and footer surfaces. Category links are the REAL slugs served
 * by GET /api/v1/catalog/categories so every footer link resolves on
 * /courses?category=<slug> (CoursesPage reads the `category` query param).
 *
 * Update this file when the marketing story changes — there is no admin
 * surface for it by design.
 */

export interface InstructorProfile {
  name: string;
  title: string;
  bio: string;
  totalStudents: number;
  totalCourses: number;
  rating: number;
  socialLinks: {
    twitter: string;
    linkedin: string;
    website: string;
    youtube: string;
  };
}

export interface Testimonial {
  name: string;
  role: string;
  quote: string;
  rating: number;
}

export interface FooterCategoryLink {
  label: string;
  /** Real catalog slug; links to /courses?category=<slug>. */
  slug: string;
}

export const INSTRUCTOR_PROFILE: InstructorProfile = {
  name: 'Daniel T. George',
  title: 'Senior Full-Stack Developer & Educator',
  bio: `With over 12 years of experience in software development and 8 years of teaching, Daniel has helped thousands of students master modern web technologies. He specializes in React, Next.js, Node.js, and cloud architecture. His practical, project-based teaching approach has earned him a reputation as one of the most effective tech educators in Africa.

Daniel holds a Master's degree in Computer Science from the University of Lagos and has worked with companies across Africa, Europe, and North America. He is passionate about making quality tech education accessible to everyone.

When he's not coding or teaching, Daniel enjoys mentoring young developers and contributing to open-source projects.`,
  totalStudents: 12847,
  totalCourses: 12,
  rating: 4.8,
  socialLinks: {
    twitter: 'https://twitter.com/dtgeorge',
    linkedin: 'https://linkedin.com/in/dtgeorge',
    website: 'https://dtg.dev',
    youtube: 'https://youtube.com/@dtgeorge',
  },
};

export const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Sarah Okonkwo',
    role: 'Frontend Developer at TechHub',
    quote:
      'DTG courses transformed my career. I went from a junior dev to a senior frontend developer in just 8 months. The practical projects were invaluable.',
    rating: 5,
  },
  {
    name: 'Emeka Nwankwo',
    role: 'Data Analyst at DataCorp',
    quote:
      "The Python for Data Science course gave me the skills I needed to land my dream job. Daniel's teaching style makes complex topics feel approachable.",
    rating: 5,
  },
  {
    name: 'Amina Bello',
    role: 'Freelance Mobile Developer',
    quote:
      "I've tried many online courses, but DTG stands out. The quality of content, the community support, and the real-world projects make all the difference.",
    rating: 5,
  },
];

/** Mirrors the seeded catalog categories (prisma/seed.ts) — keep in sync. */
export const FOOTER_CATEGORY_LINKS: FooterCategoryLink[] = [
  { label: 'Web Development', slug: 'web-development' },
  { label: 'Data Science', slug: 'data-science' },
  { label: 'Mobile Development', slug: 'mobile-development' },
  { label: 'DevOps & Cloud', slug: 'devops-and-cloud' },
  { label: 'Design & UI/UX', slug: 'design-and-ui-ux' },
];
