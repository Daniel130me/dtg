'use client';

import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ViewName } from './types';

interface NavigationState {
  currentView: ViewName;
  previousView: ViewName | null;
  viewParams: Record<string, string>;
  isAuthenticated: boolean;
  userRole: 'student' | 'instructor';
}

interface NavigationContextType extends NavigationState {
  navigate: (view: ViewName, params?: Record<string, string>) => void;
  goBack: () => void;
  login: (role?: 'student' | 'instructor') => void;
  logout: () => void;
}

const defaultState: NavigationState = {
  currentView: 'home',
  previousView: null,
  viewParams: {},
  isAuthenticated: false,
  userRole: 'student',
};

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavigationState>(defaultState);

  const navigate = useCallback((view: ViewName, params: Record<string, string> = {}) => {
    setState(prev => ({
      currentView: view,
      previousView: prev.currentView,
      viewParams: { ...params },
    }));
    window.scrollTo(0, 0);
  }, []);

  const goBack = useCallback(() => {
    setState(prev => ({
      currentView: prev.previousView || 'home',
      previousView: null,
      viewParams: {},
    }));
  }, []);

  const login = useCallback((role: 'student' | 'instructor' = 'student') => {
    setState(prev => ({
      ...prev,
      isAuthenticated: true,
      userRole: role,
      currentView: role === 'instructor' ? 'instructor-dashboard' : 'student-dashboard',
      previousView: 'home',
    }));
    window.scrollTo(0, 0);
  }, []);

  const logout = useCallback(() => {
    setState({ ...defaultState });
  }, []);

  return (
    <NavigationContext.Provider value={{ ...state, navigate, goBack, login, logout }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNav() {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNav must be used within NavigationProvider');
  return context;
}