// Student feature barrel: client-safe API wrappers + mounted page components.
export * from "@/features/learning/api";
export * from "@/features/learning/assessments-api";
export * from "@/features/learning/certificates-api";

export { default as StudentDashboardPage } from "@/components/prototype/pages/student/StudentDashboard";
export { default as MyLearningPage } from "@/components/prototype/pages/student/MyLearningPage";
export { default as LearningPlayerPage } from "@/components/prototype/pages/student/LearningPlayerPage";
export { default as CertificatesPage } from "@/components/prototype/pages/student/CertificatesPage";
export { default as ProfilePage } from "@/components/prototype/pages/student/ProfilePage";
