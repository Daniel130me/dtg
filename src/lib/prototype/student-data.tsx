'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { Enrolment, Certificate, Notification } from './types';
import { courses } from './mock-data';
import { useNav } from './navigation';

interface StudentDataContextType {
  enrolments: Enrolment[];
  certificates: Certificate[];
  notifications: Notification[];
  hoursLearned: number;
  enrollInCourse: (courseId: string) => void;
  updateLessonProgress: (courseId: string, lessonId: string, isCompleted: boolean) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

const StudentDataContext = createContext<StudentDataContextType | null>(null);

function getStorageKey(userKey: string, key: string) {
  return `dtg_${key}_${userKey}`;
}

export function StudentDataProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, userName } = useNav();
  const userKey = user?.id || user?.email || (isAuthenticated ? 'authenticated' : 'guest');

  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Load from localStorage when user/auth state changes
  useEffect(() => {
    let cancelled = false;
    // localStorage is an external system. Defer its snapshot application so
    // the effect subscribes without causing a synchronous render cascade.
    queueMicrotask(() => {
      if (cancelled) return;
      if (!isAuthenticated) {
        setEnrolments([]);
        setCertificates([]);
        setNotifications([]);
        return;
      }

      try {
        const storedEnrolments = localStorage.getItem(getStorageKey(userKey, 'enrolments'));
        const storedCertificates = localStorage.getItem(getStorageKey(userKey, 'certificates'));
        const storedNotifications = localStorage.getItem(getStorageKey(userKey, 'notifications'));

        if (storedEnrolments) {
          setEnrolments(JSON.parse(storedEnrolments));
        } else {
          setEnrolments([]);
        }

        if (storedCertificates) {
          setCertificates(JSON.parse(storedCertificates));
        } else {
          setCertificates([]);
        }

        if (storedNotifications) {
          setNotifications(JSON.parse(storedNotifications));
        } else {
          const welcomeNotif: Notification = {
            id: `notif-welcome-${Date.now()}`,
            title: 'Welcome to DTG! 👋',
            message: `Hello ${user?.name || userName || 'there'}! Welcome to your learning portal. Explore our course catalog to get started.`,
            type: 'announcement',
            createdAt: 'Just now',
            isRead: false,
          };
          setNotifications([welcomeNotif]);
          localStorage.setItem(getStorageKey(userKey, 'notifications'), JSON.stringify([welcomeNotif]));
        }
      } catch {
        // Ignore localStorage errors
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userKey, isAuthenticated, user?.name, userName]);

  const enrollInCourse = useCallback((courseId: string) => {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;

    setEnrolments((prev) => {
      const exists = prev.some((e) => e.courseId === courseId);
      if (exists) return prev;

      const firstLesson = course.sections[0]?.lessons[0];
      const newEnrolment: Enrolment = {
        id: `enrol-${Date.now()}`,
        courseId: course.id,
        courseName: course.title,
        courseThumbnail: course.thumbnail,
        progress: 0,
        currentLessonId: firstLesson?.id || 'les-1',
        currentLessonTitle: firstLesson?.title || 'Introduction',
        enrolledAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        lastAccessed: 'Today',
        status: 'active',
      };

      const updated = [newEnrolment, ...prev];
      if (isAuthenticated) {
        try {
          localStorage.setItem(getStorageKey(userKey, 'enrolments'), JSON.stringify(updated));
        } catch {
          // Ignore
        }
      }
      return updated;
    });

    const notif: Notification = {
      id: `notif-enrolled-${Date.now()}`,
      title: 'Course Enrolment Confirmed 🎉',
      message: `You have successfully enrolled in "${course.title}". Start learning now!`,
      type: 'enrollment',
      createdAt: 'Just now',
      isRead: false,
    };
    setNotifications((prev) => {
      const updated = [notif, ...prev];
      if (isAuthenticated) {
        try {
          localStorage.setItem(getStorageKey(userKey, 'notifications'), JSON.stringify(updated));
        } catch {
          // Ignore
        }
      }
      return updated;
    });
  }, [userKey, isAuthenticated]);

  const updateLessonProgress = useCallback((courseId: string, lessonId: string, isCompleted: boolean) => {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;

    setEnrolments((prev) => {
      const index = prev.findIndex((e) => e.courseId === courseId);
      if (index === -1) return prev;

      const target = prev[index];
      const totalLessons = course.totalLessons || 10;
      const newProgress = Math.min(100, Math.max(0, target.progress + (isCompleted ? Math.round(100 / totalLessons) : -Math.round(100 / totalLessons))));
      const isNowCompleted = newProgress >= 100;

      const updatedEnrolment: Enrolment = {
        ...target,
        progress: isNowCompleted ? 100 : newProgress,
        status: isNowCompleted ? 'completed' : 'active',
        currentLessonId: lessonId,
        lastAccessed: 'Today',
      };

      const updated = [...prev];
      updated[index] = updatedEnrolment;

      if (isAuthenticated) {
        try {
          localStorage.setItem(getStorageKey(userKey, 'enrolments'), JSON.stringify(updated));
        } catch {
          // Ignore
        }
      }

      if (isNowCompleted && target.status !== 'completed') {
        const newCert: Certificate = {
          id: `cert-${Date.now()}`,
          courseId: course.id,
          courseName: course.title,
          completedAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          certificateId: `DTG-${new Date().getFullYear()}-${course.id.replace('course-', '').toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
          verificationCode: `dtg_v_${Math.random().toString(36).substring(2, 10)}`,
        };
        setCertificates((cPrev) => {
          const cUpdated = [newCert, ...cPrev.filter((c) => c.courseId !== course.id)];
          if (isAuthenticated) {
            try {
              localStorage.setItem(getStorageKey(userKey, 'certificates'), JSON.stringify(cUpdated));
            } catch {
              // Ignore
            }
          }
          return cUpdated;
        });

        const certNotif: Notification = {
          id: `notif-cert-${Date.now()}`,
          title: 'Certificate Earned! 🎓',
          message: `Congratulations on completing "${course.title}"! Your certificate is now available.`,
          type: 'grade',
          createdAt: 'Just now',
          isRead: false,
        };
        setNotifications((nPrev) => {
          const nUpdated = [certNotif, ...nPrev];
          if (isAuthenticated) {
            try {
              localStorage.setItem(getStorageKey(userKey, 'notifications'), JSON.stringify(nUpdated));
            } catch {
              // Ignore
            }
          }
          return nUpdated;
        });
      }

      return updated;
    });
  }, [userKey, isAuthenticated]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, isRead: true } : n));
      if (isAuthenticated) {
        try {
          localStorage.setItem(getStorageKey(userKey, 'notifications'), JSON.stringify(updated));
        } catch {
          // Ignore
        }
      }
      return updated;
    });
  }, [userKey, isAuthenticated]);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, isRead: true }));
      if (isAuthenticated) {
        try {
          localStorage.setItem(getStorageKey(userKey, 'notifications'), JSON.stringify(updated));
        } catch {
          // Ignore
        }
      }
      return updated;
    });
  }, [userKey, isAuthenticated]);

  const hoursLearned = useMemo(() => {
    return enrolments.reduce((acc, e) => {
      const course = courses.find((c) => c.id === e.courseId);
      const courseHours = course ? parseInt(course.duration, 10) || 10 : 10;
      return acc + Math.round((courseHours * e.progress) / 100);
    }, 0);
  }, [enrolments]);

  return (
    <StudentDataContext.Provider
      value={{
        enrolments,
        certificates,
        notifications,
        hoursLearned,
        enrollInCourse,
        updateLessonProgress,
        markNotificationRead,
        markAllNotificationsRead,
      }}
    >
      {children}
    </StudentDataContext.Provider>
  );
}

export function useStudentData() {
  const context = useContext(StudentDataContext);
  if (!context) {
    throw new Error('useStudentData must be used within a StudentDataProvider');
  }
  return context;
}
