'use client';

import React from 'react';
import { NavigationProvider, useNav } from '@/lib/prototype/navigation';
import Header from '@/components/prototype/layout/Header';
import Footer from '@/components/prototype/layout/Footer';
import HomePage from '@/components/prototype/pages/public/HomePage';
import CoursesPage from '@/components/prototype/pages/public/CoursesPage';
import CourseDetailPage from '@/components/prototype/pages/public/CourseDetailPage';
import AboutPage from '@/components/prototype/pages/public/AboutPage';
import ContactPage from '@/components/prototype/pages/public/ContactPage';
import LoginModal from '@/components/prototype/pages/public/LoginModal';
import RegisterModal from '@/components/prototype/pages/public/RegisterModal';
import StudentDashboard from '@/components/prototype/pages/student/StudentDashboard';
import MyLearningPage from '@/components/prototype/pages/student/MyLearningPage';
import LearningPlayerPage from '@/components/prototype/pages/student/LearningPlayerPage';
import CertificatesPage from '@/components/prototype/pages/student/CertificatesPage';
import ProfilePage from '@/components/prototype/pages/student/ProfilePage';
import InstructorDashboard from '@/components/prototype/pages/instructor/InstructorDashboard';
import CourseManagement from '@/components/prototype/pages/instructor/CourseManagement';
import StudentManagement from '@/components/prototype/pages/instructor/StudentManagement';
import AnalyticsPage from '@/components/prototype/pages/instructor/AnalyticsPage';
import CreateCoursePage from '@/components/prototype/pages/instructor/CreateCoursePage';

function AppContent() {
  const { currentView, isAuthenticated } = useNav();

  const publicViews: Record<string, React.ReactNode> = {
    home: <HomePage />,
    courses: <CoursesPage />,
    'course-detail': <CourseDetailPage />,
    about: <AboutPage />,
    contact: <ContactPage />,
    login: <LoginModal />,
    register: <RegisterModal />,
  };

  const studentViews: Record<string, React.ReactNode> = {
    'student-dashboard': <StudentDashboard />,
    'my-learning': <MyLearningPage />,
    'learning-player': <LearningPlayerPage />,
    'certificates': <CertificatesPage />,
    'profile': <ProfilePage />,
  };

  const instructorViews: Record<string, React.ReactNode> = {
    'instructor-dashboard': <InstructorDashboard />,
    'course-management': <CourseManagement />,
    'student-management': <StudentManagement />,
    'analytics': <AnalyticsPage />,
    'create-course': <CreateCoursePage />,
  };

  const isPublicView = currentView in publicViews;
  const isStudentView = currentView in studentViews;
  const isInstructorView = currentView in instructorViews;

  // Student pages have their own layout (sidebar), no header/footer
  if (isStudentView) {
    return studentViews[currentView];
  }

  // Instructor pages have their own layout (dark sidebar), no header/footer
  if (isInstructorView) {
    return instructorViews[currentView];
  }

  return (
    <div className='min-h-screen flex flex-col bg-background'>
      <Header />
      {isPublicView ? (
        publicViews[currentView]
      ) : (
        <main className='flex-1 flex items-center justify-center'>
          <div className='text-center'>
            <div className='size-16 mx-auto rounded-full bg-muted flex items-center justify-center mb-4'>
              <span className='text-2xl font-bold text-muted-foreground'>?</span>
            </div>
            <h2 className='text-xl font-semibold mb-2'>Coming Soon</h2>
            <p className='text-sm text-muted-foreground'>The <span className='font-mono bg-muted px-1.5 py-0.5 rounded text-xs'>{currentView}</span> view is under development.</p>
          </div>
        </main>
      )}
      <Footer />
    </div>
  );
}

export default function Home() {
  return (
    <NavigationProvider>
      <AppContent />
    </NavigationProvider>
  );
}
