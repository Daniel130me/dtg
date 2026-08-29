import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/auth/PasswordRecoveryForm';

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetPasswordForm /></Suspense>;
}
