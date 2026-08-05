export type ViewName =
  | 'home'
  | 'courses'
  | 'course-detail'
  | 'about'
  | 'contact'
  | 'login'
  | 'register'
  | 'student-dashboard'
  | 'my-learning'
  | 'learning-player'
  | 'certificates'
  | 'profile'
  | 'instructor-dashboard'
  | 'course-management'
  | 'student-management'
  | 'analytics'
  | 'create-course';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'instructor';
  avatar?: string;
  country?: string;
  joinedAt: string;
  bio?: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  courseCount: number;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  thumbnail: string;
  categoryId: string;
  categoryName: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  duration: string;
  totalLessons: number;
  totalSections: number;
  studentsEnrolled: number;
  rating: number;
  reviewCount: number;
  price: number | null;
  isFree: boolean;
  isPublished: boolean;
  badge?: 'new' | 'popular' | 'free';
  language: string;
  lastUpdated: string;
  instructor: Instructor;
  sections: Section[];
  requirements: string[];
  whatYouLearn: string[];
}

export interface Section {
  id: string;
  title: string;
  order: number;
  lessons: Lesson[];
}

export interface Lesson {
  id: string;
  title: string;
  type: 'video' | 'text' | 'quiz' | 'assignment';
  duration: string;
  isPreview: boolean;
  isCompleted?: boolean;
  content?: string;
  videoUrl?: string;
  resources?: Resource[];
}

export interface Resource {
  id: string;
  name: string;
  type: 'pdf' | 'zip' | 'doc' | 'link';
  size: string;
  url: string;
}

export interface Instructor {
  id: string;
  name: string;
  title: string;
  bio: string;
  avatar: string;
  totalStudents: number;
  totalCourses: number;
  rating: number;
  socialLinks: {
    twitter?: string;
    linkedin?: string;
    website?: string;
    youtube?: string;
  };
}

export interface Review {
  id: string;
  courseId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  rating: number;
  comment: string;
  date: string;
  instructorReply?: string;
}

export interface Enrolment {
  id: string;
  courseId: string;
  courseName: string;
  courseThumbnail: string;
  progress: number;
  status: 'active' | 'completed' | 'suspended';
  enrolledAt: string;
  lastAccessed: string;
  currentLessonId?: string;
  currentLessonTitle?: string;
}

export interface Certificate {
  id: string;
  courseId: string;
  courseName: string;
  completedAt: string;
  certificateId: string;
  verificationCode: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'announcement' | 'grade' | 'enrollment' | 'reminder' | 'system';
  isRead: boolean;
  createdAt: string;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  content: string;
  createdAt: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  type: 'multiple-choice' | 'true-false' | 'short-answer';
  options?: string[];
  correctAnswer: string | number;
  points: number;
}

export interface AssessmentResult {
  id: string;
  assessmentName: string;
  courseId: string;
  courseName: string;
  score: number;
  totalPoints: number;
  passed: boolean;
  completedAt: string;
}

export interface AnalyticsData {
  totalStudents: number;
  totalCourses: number;
  totalEnrollments: number;
  completionRate: number;
  averageRating: number;
  revenue: number;
  monthlyEnrollments: { month: string; count: number }[];
  coursePerformance: { name: string; enrollments: number; completionRate: number; rating: number }[];
  topCourses: { name: string; students: number; revenue: number }[];
  recentActivity: { action: string; user: string; time: string; course?: string }[];
}
