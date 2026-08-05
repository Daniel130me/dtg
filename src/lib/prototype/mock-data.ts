import { Category, Course, Instructor, Review, Enrolment, Certificate, Notification, AnalyticsData, User } from './types';

export const currentUser: User = {
  id: 'user-1',
  name: 'John Adebayo',
  email: 'john@example.com',
  role: 'student',
  country: 'Nigeria',
  joinedAt: '2024-08-15',
  bio: 'Passionate learner focused on web development and data science.',
};

export const instructor: Instructor = {
  id: 'instructor-1',
  name: 'Daniel T. George',
  title: 'Senior Full-Stack Developer & Educator',
  bio: `With over 12 years of experience in software development and 8 years of teaching, Daniel has helped thousands of students master modern web technologies. He specializes in React, Next.js, Node.js, and cloud architecture. His practical, project-based teaching approach has earned him a reputation as one of the most effective tech educators in Africa.

Daniel holds a Master's degree in Computer Science from the University of Lagos and has worked with companies across Africa, Europe, and North America. He is passionate about making quality tech education accessible to everyone.

When he's not coding or teaching, Daniel enjoys mentoring young developers and contributing to open-source projects.`,
  avatar: '',
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

export const categories: Category[] = [
  { id: 'cat-1', name: 'Web Development', icon: 'Code', courseCount: 5 },
  { id: 'cat-2', name: 'Data Science', icon: 'BarChart3', courseCount: 3 },
  { id: 'cat-3', name: 'Mobile Development', icon: 'Smartphone', courseCount: 2 },
  { id: 'cat-4', name: 'DevOps & Cloud', icon: 'Cloud', courseCount: 1 },
  { id: 'cat-5', name: 'Design & UI/UX', icon: 'Palette', courseCount: 1 },
];

export const courses: Course[] = [
  {
    id: 'course-1',
    title: 'Complete Next.js 15 & React Masterclass',
    slug: 'complete-nextjs-react-masterclass',
    description: 'Master modern web development with Next.js 15 and React 19. Build production-ready applications with server components, streaming, and the latest features. This comprehensive course covers everything from fundamentals to advanced patterns, including authentication, database integration, deployment, and performance optimization.',
    shortDescription: 'Build production-ready apps with Next.js 15, React 19, Server Components, and modern full-stack techniques.',
    thumbnail: '',
    categoryId: 'cat-1',
    categoryName: 'Web Development',
    level: 'Intermediate',
    duration: '42 hours',
    totalLessons: 156,
    totalSections: 12,
    studentsEnrolled: 3421,
    rating: 4.9,
    reviewCount: 847,
    price: 49.99,
    isFree: false,
    isPublished: true,
    badge: 'popular',
    language: 'English',
    lastUpdated: '2025-01-10',
    instructor,
    sections: [
      {
        id: 'sec-1', title: 'Getting Started with Next.js 15', order: 1,
        lessons: [
          { id: 'les-1', title: 'Introduction to Next.js 15', type: 'video', duration: '12:30', isPreview: true, isCompleted: true },
          { id: 'les-2', title: 'Setting Up Your Development Environment', type: 'video', duration: '18:45', isPreview: true, isCompleted: true },
          { id: 'les-3', title: 'Understanding the App Router', type: 'video', duration: '22:10', isPreview: false, isCompleted: true },
          { id: 'les-4', title: 'Project Structure Best Practices', type: 'text', duration: '10 min read', isPreview: false, isCompleted: false },
          { id: 'les-5', title: 'Section Quiz: Fundamentals', type: 'quiz', duration: '15 min', isPreview: false, isCompleted: false },
        ],
      },
      {
        id: 'sec-2', title: 'React Server Components Deep Dive', order: 2,
        lessons: [
          { id: 'les-6', title: 'Server vs Client Components', type: 'video', duration: '25:00', isPreview: false, isCompleted: false },
          { id: 'les-7', title: 'Data Fetching Patterns', type: 'video', duration: '30:15', isPreview: false, isCompleted: false },
          { id: 'les-8', title: 'Streaming & Suspense', type: 'video', duration: '20:30', isPreview: false, isCompleted: false },
          { id: 'les-9', title: 'Server Actions', type: 'video', duration: '28:00', isPreview: false, isCompleted: false },
          { id: 'les-10', title: 'Assignment: Build a RSC Dashboard', type: 'assignment', duration: '2 hours', isPreview: false, isCompleted: false },
        ],
      },
      {
        id: 'sec-3', title: 'Database & Authentication', order: 3,
        lessons: [
          { id: 'les-11', title: 'Prisma ORM Setup', type: 'video', duration: '22:00', isPreview: false, isCompleted: false },
          { id: 'les-12', title: 'Database Schema Design', type: 'video', duration: '35:00', isPreview: false, isCompleted: false },
          { id: 'les-13', title: 'NextAuth.js Integration', type: 'video', duration: '28:00', isPreview: false, isCompleted: false },
          { id: 'les-14', title: 'Role-Based Access Control', type: 'video', duration: '20:00', isPreview: false, isCompleted: false },
        ],
      },
      {
        id: 'sec-4', title: 'Styling & UI', order: 4,
        lessons: [
          { id: 'les-15', title: 'Tailwind CSS 4 Mastery', type: 'video', duration: '32:00', isPreview: false, isCompleted: false },
          { id: 'les-16', title: 'shadcn/ui Components', type: 'video', duration: '25:00', isPreview: false, isCompleted: false },
          { id: 'les-17', title: 'Framer Motion Animations', type: 'video', duration: '18:00', isPreview: false, isCompleted: false },
        ],
      },
      {
        id: 'sec-5', title: 'Testing & Deployment', order: 5,
        lessons: [
          { id: 'les-18', title: 'Unit Testing with Vitest', type: 'video', duration: '24:00', isPreview: false, isCompleted: false },
          { id: 'les-19', title: 'E2E Testing with Playwright', type: 'video', duration: '20:00', isPreview: false, isCompleted: false },
          { id: 'les-20', title: 'Deploying to Vercel & AWS', type: 'video', duration: '30:00', isPreview: false, isCompleted: false },
        ],
      },
    ],
    requirements: ['Basic HTML, CSS, and JavaScript knowledge', 'Familiarity with React fundamentals', 'Node.js installed on your computer', 'A code editor (VS Code recommended)'],
    whatYouLearn: ['Build full-stack applications with Next.js 15', 'Master React Server Components and Streaming', 'Implement authentication with NextAuth.js', 'Design databases with Prisma ORM', 'Deploy production applications', 'Write comprehensive tests'],
  },
  {
    id: 'course-2',
    title: 'Python for Data Science & Machine Learning',
    slug: 'python-data-science-ml',
    description: 'Learn Python programming for data science and machine learning from scratch. This course takes you from Python basics through advanced data analysis, visualization, and machine learning techniques using real-world datasets and projects.',
    shortDescription: 'From Python basics to advanced ML — master data science with hands-on projects and real datasets.',
    thumbnail: '',
    categoryId: 'cat-2',
    categoryName: 'Data Science',
    level: 'Beginner',
    duration: '38 hours',
    totalLessons: 134,
    totalSections: 10,
    studentsEnrolled: 2890,
    rating: 4.7,
    reviewCount: 623,
    price: 39.99,
    isFree: false,
    isPublished: true,
    badge: 'popular',
    language: 'English',
    lastUpdated: '2025-01-05',
    instructor,
    sections: [
      {
        id: 'sec-6', title: 'Python Fundamentals', order: 1,
        lessons: [
          { id: 'les-21', title: 'Introduction to Python', type: 'video', duration: '15:00', isPreview: true, isCompleted: true },
          { id: 'les-22', title: 'Variables & Data Types', type: 'video', duration: '20:00', isPreview: true, isCompleted: true },
          { id: 'les-23', title: 'Control Flow', type: 'video', duration: '25:00', isPreview: false, isCompleted: false },
        ],
      },
      {
        id: 'sec-7', title: 'Data Analysis with Pandas', order: 2,
        lessons: [
          { id: 'les-24', title: 'Introduction to Pandas', type: 'video', duration: '22:00', isPreview: false, isCompleted: false },
          { id: 'les-25', title: 'Data Cleaning & Preprocessing', type: 'video', duration: '28:00', isPreview: false, isCompleted: false },
        ],
      },
    ],
    requirements: ['No prior programming experience needed', 'A computer with internet access', 'Willingness to learn and practice'],
    whatYouLearn: ['Python programming from scratch', 'Data manipulation with Pandas', 'Data visualization with Matplotlib', 'Machine learning with Scikit-learn', 'Real-world project experience'],
  },
  {
    id: 'course-3',
    title: 'React Native Mobile App Development',
    slug: 'react-native-mobile-dev',
    description: 'Build beautiful, native mobile applications for iOS and Android using React Native. Learn component patterns, navigation, state management, native APIs, and deployment to app stores.',
    shortDescription: 'Build cross-platform mobile apps with React Native — from setup to App Store deployment.',
    thumbnail: '',
    categoryId: 'cat-3',
    categoryName: 'Mobile Development',
    level: 'Intermediate',
    duration: '35 hours',
    totalLessons: 112,
    totalSections: 9,
    studentsEnrolled: 1654,
    rating: 4.8,
    reviewCount: 389,
    price: 44.99,
    isFree: false,
    isPublished: true,
    badge: 'new',
    language: 'English',
    lastUpdated: '2025-01-12',
    instructor,
    sections: [
      {
        id: 'sec-8', title: 'React Native Basics', order: 1,
        lessons: [
          { id: 'les-26', title: 'Setting Up React Native', type: 'video', duration: '18:00', isPreview: true, isCompleted: false },
          { id: 'les-27', title: 'Core Components', type: 'video', duration: '25:00', isPreview: true, isCompleted: false },
        ],
      },
    ],
    requirements: ['Basic React knowledge', 'JavaScript ES6+ fundamentals', 'Node.js and npm installed'],
    whatYouLearn: ['Build cross-platform mobile apps', 'Navigation and routing patterns', 'State management with Zustand', 'Native API integration', 'App Store deployment'],
  },
  {
    id: 'course-4',
    title: 'Node.js Backend Development',
    slug: 'nodejs-backend-development',
    description: 'Master backend development with Node.js and Express. Build RESTful APIs, implement authentication, work with databases, handle file uploads, and deploy your applications.',
    shortDescription: 'Build scalable backend APIs with Node.js, Express, MongoDB, and modern backend patterns.',
    thumbnail: '',
    categoryId: 'cat-1',
    categoryName: 'Web Development',
    level: 'Intermediate',
    duration: '30 hours',
    totalLessons: 98,
    totalSections: 8,
    studentsEnrolled: 2103,
    rating: 4.6,
    reviewCount: 512,
    price: 39.99,
    isFree: false,
    isPublished: true,
    badge: undefined,
    language: 'English',
    lastUpdated: '2024-12-20',
    instructor,
    sections: [
      {
        id: 'sec-9', title: 'Node.js Fundamentals', order: 1,
        lessons: [
          { id: 'les-28', title: 'Introduction to Node.js', type: 'video', duration: '15:00', isPreview: true, isCompleted: false },
        ],
      },
    ],
    requirements: ['JavaScript fundamentals', 'Basic understanding of HTTP', 'Node.js installed'],
    whatYouLearn: ['RESTful API development', 'Authentication & authorization', 'Database integration', 'Error handling patterns', 'Deployment strategies'],
  },
  {
    id: 'course-5',
    title: 'Introduction to UI/UX Design',
    slug: 'intro-ui-ux-design',
    description: 'Learn the fundamentals of UI/UX design. Understand user research, wireframing, prototyping, visual design principles, and usability testing to create user-centered digital products.',
    shortDescription: 'Master UI/UX fundamentals — research, wireframing, prototyping, and user testing.',
    thumbnail: '',
    categoryId: 'cat-5',
    categoryName: 'Design & UI/UX',
    level: 'Beginner',
    duration: '20 hours',
    totalLessons: 64,
    totalSections: 7,
    studentsEnrolled: 956,
    rating: 4.5,
    reviewCount: 198,
    price: null,
    isFree: true,
    isPublished: true,
    badge: 'free',
    language: 'English',
    lastUpdated: '2024-12-15',
    instructor,
    sections: [
      {
        id: 'sec-10', title: 'Design Thinking', order: 1,
        lessons: [
          { id: 'les-29', title: 'What is UI/UX Design?', type: 'video', duration: '12:00', isPreview: true, isCompleted: false },
        ],
      },
    ],
    requirements: ['No prior design experience needed', 'A computer with internet access', 'Figma account (free)'],
    whatYouLearn: ['Design thinking methodology', 'User research techniques', 'Wireframing and prototyping', 'Visual design principles', 'Usability testing'],
  },
  {
    id: 'course-6',
    title: 'TypeScript Advanced Patterns',
    slug: 'typescript-advanced-patterns',
    description: 'Take your TypeScript skills to the next level. Learn advanced type patterns, generics, decorators, module patterns, and best practices for large-scale application development.',
    shortDescription: 'Advanced TypeScript — generics, decorators, patterns, and architecture for large apps.',
    thumbnail: '',
    categoryId: 'cat-1',
    categoryName: 'Web Development',
    level: 'Advanced',
    duration: '25 hours',
    totalLessons: 78,
    totalSections: 8,
    studentsEnrolled: 1823,
    rating: 4.9,
    reviewCount: 445,
    price: 34.99,
    isFree: false,
    isPublished: true,
    badge: 'new',
    language: 'English',
    lastUpdated: '2025-01-08',
    instructor,
    sections: [
      {
        id: 'sec-11', title: 'Advanced Type System', order: 1,
        lessons: [
          { id: 'les-30', title: 'Generic Constraints', type: 'video', duration: '20:00', isPreview: true, isCompleted: false },
        ],
      },
    ],
    requirements: ['Strong TypeScript fundamentals', 'Experience with design patterns', 'Familiarity with React or Node.js'],
    whatYouLearn: ['Advanced generic patterns', 'Conditional & mapped types', 'Decorators and metadata', 'Module augmentation', 'Large-scale architecture'],
  },
];

export const reviews: Review[] = [
  {
    id: 'rev-1', courseId: 'course-1', userId: 'u1', userName: 'Sarah Okonkwo',
    userAvatar: '', rating: 5,
    comment: 'This is by far the best Next.js course I\'ve taken. Daniel explains complex concepts in a way that\'s easy to understand. The project-based approach really helped me build confidence.',
    date: '2025-01-08',
    instructorReply: 'Thank you so much, Sarah! I\'m glad the project-based approach worked well for you. Keep building!',
  },
  {
    id: 'rev-2', courseId: 'course-1', userId: 'u2', userName: 'Emeka Nwankwo',
    userAvatar: '', rating: 5,
    comment: 'Excellent course! The section on Server Components was exactly what I needed. I went from confused to confident in just a few lessons.',
    date: '2025-01-05',
  },
  {
    id: 'rev-3', courseId: 'course-1', userId: 'u3', userName: 'Amina Bello',
    userAvatar: '', rating: 4,
    comment: 'Great content and well-structured. Would love to see more on testing patterns in future updates. Overall, highly recommended!',
    date: '2024-12-28',
    instructorReply: 'Thanks Amina! Testing is crucial — I\'ll be adding more testing content in the next update.',
  },
  {
    id: 'rev-4', courseId: 'course-2', userId: 'u4', userName: 'Tunde Adeyemi',
    userAvatar: '', rating: 5,
    comment: 'As someone switching from finance to tech, this course made data science accessible. The real-world projects were incredibly valuable.',
    date: '2025-01-02',
  },
  {
    id: 'rev-5', courseId: 'course-3', userId: 'u5', userName: 'Chioma Eze',
    userAvatar: '', rating: 4,
    comment: 'Solid course for learning React Native. The navigation section could be a bit more detailed, but overall very good value.',
    date: '2024-12-20',
  },
];

export const enrolments: Enrolment[] = [
  {
    id: 'enr-1', courseId: 'course-1', courseName: 'Complete Next.js 15 & React Masterclass',
    courseThumbnail: '', progress: 35, status: 'active', enrolledAt: '2024-11-01',
    lastAccessed: '2025-01-12', currentLessonId: 'les-6', currentLessonTitle: 'Server vs Client Components',
  },
  {
    id: 'enr-2', courseId: 'course-2', courseName: 'Python for Data Science & Machine Learning',
    courseThumbnail: '', progress: 68, status: 'active', enrolledAt: '2024-09-15',
    lastAccessed: '2025-01-10', currentLessonId: 'les-24', currentLessonTitle: 'Introduction to Pandas',
  },
  {
    id: 'enr-3', courseId: 'course-5', courseName: 'Introduction to UI/UX Design',
    courseThumbnail: '', progress: 100, status: 'completed', enrolledAt: '2024-07-20',
    lastAccessed: '2024-10-05',
  },
];

export const certificates: Certificate[] = [
  {
    id: 'cert-1', courseId: 'course-5', courseName: 'Introduction to UI/UX Design',
    completedAt: '2024-10-05', certificateId: 'DTG-2024-0847', verificationCode: 'VERIFY-A8F3K9M2',
  },
];

export const notifications: Notification[] = [
  { id: 'notif-1', title: 'New Course Published', message: 'TypeScript Advanced Patterns is now available!', type: 'announcement', isRead: false, createdAt: '2025-01-12' },
  { id: 'notif-2', title: 'Assignment Graded', message: 'Your assignment in Next.js course scored 92/100', type: 'grade', isRead: false, createdAt: '2025-01-11' },
  { id: 'notif-3', title: 'Course Update', message: 'New lessons added to the Next.js course', type: 'announcement', isRead: true, createdAt: '2025-01-10' },
  { id: 'notif-4', title: 'Reminder', message: 'You have an upcoming quiz due in 2 days', type: 'reminder', isRead: true, createdAt: '2025-01-09' },
  { id: 'notif-5', title: 'Welcome to DTG!', message: 'Your account has been created successfully', type: 'system', isRead: true, createdAt: '2024-08-15' },
];

export const analyticsData: AnalyticsData = {
  totalStudents: 12847,
  totalCourses: 12,
  totalEnrollments: 18923,
  completionRate: 67,
  averageRating: 4.8,
  revenue: 487650,
  monthlyEnrollments: [
    { month: 'Aug', count: 1200 }, { month: 'Sep', count: 1450 }, { month: 'Oct', count: 1380 },
    { month: 'Nov', count: 1620 }, { month: 'Dec', count: 1890 }, { month: 'Jan', count: 2100 },
  ],
  coursePerformance: [
    { name: 'Next.js Masterclass', enrollments: 3421, completionRate: 72, rating: 4.9 },
    { name: 'Python Data Science', enrollments: 2890, completionRate: 65, rating: 4.7 },
    { name: 'React Native', enrollments: 1654, completionRate: 58, rating: 4.8 },
    { name: 'Node.js Backend', enrollments: 2103, completionRate: 70, rating: 4.6 },
  ],
  topCourses: [
    { name: 'Next.js Masterclass', students: 3421, revenue: 170850 },
    { name: 'Python Data Science', students: 2890, revenue: 115500 },
    { name: 'Node.js Backend', students: 2103, revenue: 84090 },
  ],
  recentActivity: [
    { action: 'Enrolled', user: 'Sarah Okonkwo', time: '2 hours ago', course: 'Next.js Masterclass' },
    { action: 'Completed', user: 'Emeka Nwankwo', time: '3 hours ago', course: 'Python Data Science' },
    { action: 'Submitted Assignment', user: 'Amina Bello', time: '5 hours ago', course: 'React Native' },
    { action: 'Left Review', user: 'Tunde Adeyemi', time: '6 hours ago', course: 'TypeScript Advanced' },
    { action: 'Enrolled', user: 'Chioma Eze', time: '8 hours ago', course: 'UI/UX Design' },
  ],
};

export const testimonials = [
  {
    name: 'Sarah Okonkwo', role: 'Frontend Developer at TechHub',
    quote: 'DTG courses transformed my career. I went from a junior dev to a senior frontend developer in just 8 months. The practical projects were invaluable.',
    avatar: '', rating: 5,
  },
  {
    name: 'Emeka Nwankwo', role: 'Data Analyst at DataCorp',
    quote: 'The Python for Data Science course gave me the skills I needed to land my dream job. Daniel\'s teaching style makes complex topics feel approachable.',
    avatar: '', rating: 5,
  },
  {
    name: 'Amina Bello', role: 'Freelance Mobile Developer',
    quote: 'I\'ve tried many online courses, but DTG stands out. The quality of content, the community support, and the real-world projects make all the difference.',
    avatar: '', rating: 5,
  },
];
