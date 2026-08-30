'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  User,
  Mail,
  MapPin,
  Calendar,
  Pencil,
  Check,
  Bell,
  Globe,
  Lock,
  Eye,
  EyeOff,
  Shield,
  BookOpen,
  Download,
  Loader2,
  LogIn,
} from 'lucide-react';
import StudentLayout from '@/components/prototype/layout/StudentLayout';
import { authClient } from '@/lib/client/auth-client';
import { ApiClientError } from '@/lib/client/api-client';
import {
  changeAccountPassword,
  deleteAccount,
  exportAccountData,
  fetchAccountProfile,
  updateAccountProfile,
} from '@/features/accounts/api';
import {
  ACCOUNT_PASSWORD_MIN_LENGTH,
  LOCALES,
  type AccountProfileDto,
  type LocaleValue,
  type NotificationPrefKey,
} from '@/contracts/accounts';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// --- Motion presets (carried over from the prototype profile page) ----------

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

// --- Display constants -------------------------------------------------------

/** The exact word the server requires for deletion (contract-shared value). */
const DELETION_WORD = 'DELETE';

const LOCALE_LABELS: Record<LocaleValue, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
};

/** Same initials rule as the rest of the student surfaces. */
function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// --- Small shared pieces ------------------------------------------------------

interface InlineErrorProps {
  message: string | null;
}

/** role=alert so screen readers announce failed saves (house a11y rule). */
function InlineError({ message }: InlineErrorProps) {
  if (!message) return null;
  return (
    <p role='alert' className='text-sm text-destructive'>
      {message}
    </p>
  );
}

/** Password input with the show/hide toggle from the prototype, labelled. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className='space-y-2 max-w-md'>
      <Label htmlFor={id} className='text-sm font-medium'>
        {label}
      </Label>
      <div className='relative'>
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className='pr-10'
        />
        <button
          type='button'
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors'
        >
          {visible ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
        </button>
      </div>
    </div>
  );
}

/** Mirrors the profile card so the page keeps its height while loading. */
function ProfileSkeleton() {
  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <Skeleton className='h-5 w-44' />
          <Skeleton className='h-3.5 w-64' />
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='flex items-center gap-4'>
            <Skeleton className='size-20 rounded-2xl' />
            <div className='space-y-2'>
              <Skeleton className='h-4 w-32' />
              <Skeleton className='h-3 w-48' />
            </div>
          </div>
          <Separator />
          <div className='grid sm:grid-cols-2 gap-4'>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className='space-y-2'>
                <Skeleton className='h-3.5 w-24' />
                <Skeleton className='h-4 w-40' />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className='h-5 w-52' />
        </CardHeader>
        <CardContent className='space-y-4'>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className='flex items-center justify-between'>
              <div className='space-y-1.5'>
                <Skeleton className='h-4 w-40' />
                <Skeleton className='h-3 w-64' />
              </div>
              <Skeleton className='h-5 w-10 rounded-full' />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Page ---------------------------------------------------------------------

export default function ProfilePage() {
  const router = useRouter();
  // Session supplies the live email/verification badge; everything else comes
  // from the account profile API.
  const { data: session } = authClient.useSession();

  const [profile, setProfile] = useState<AccountProfileDto | null>(null);
  const [error, setError] = useState<{ message: string; sessionExpired: boolean } | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);

  // Loading is DERIVED from the request key (StudentDashboard pattern); every
  // setState lives in an async callback or an event handler.
  const [loadedKey, setLoadedKey] = useState<number | null>(null);
  const requestKey = retrySeed;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchAccountProfile()
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError({
          message: err instanceof Error ? err.message : 'Failed to load your profile.',
          sessionExpired: err instanceof ApiClientError && err.status === 401,
        });
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  // --- Profile information (view/edit) ---------------------------------------

  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [draftCountry, setDraftCountry] = useState('');
  const [draftLocale, setDraftLocale] = useState<LocaleValue>('en');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const startEditing = () => {
    if (!profile) return;
    setDraftName(profile.profile.displayName);
    setDraftBio(profile.profile.bio ?? '');
    setDraftCountry(profile.profile.countryCode ?? '');
    setDraftLocale(profile.profile.locale);
    setProfileError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setProfileError(null);
  };

  const handleSaveProfile = () => {
    if (!profile) return;
    const name = draftName.trim();
    if (!name) {
      setProfileError('Name cannot be empty.');
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    updateAccountProfile({
      name,
      // Empty strings clear the field; the server stores NULL.
      bio: draftBio.trim() === '' ? null : draftBio.trim(),
      countryCode: draftCountry.trim() === '' ? null : draftCountry.trim().toUpperCase(),
      locale: draftLocale,
    })
      .then((dto) => {
        setProfile(dto);
        setIsEditing(false);
        toast.success('Profile updated');
      })
      .catch((err: unknown) => {
        setProfileError(err instanceof Error ? err.message : 'Could not save your profile.');
      })
      .finally(() => setSavingProfile(false));
  };

  // --- Notification preferences (optimistic toggles) --------------------------

  const [savingPrefKey, setSavingPrefKey] = useState<NotificationPrefKey | null>(null);

  const handlePrefToggle = (key: NotificationPrefKey, checked: boolean) => {
    if (!profile || savingPrefKey === key) return;
    const previous = profile;
    // Optimistic flip, then adopt the server's merged document; any failure
    // reverts to the previous state so the UI never lies about what is saved.
    setProfile({
      ...profile,
      profile: {
        ...profile.profile,
        notificationPrefs: { ...profile.profile.notificationPrefs, [key]: checked },
      },
    });
    setSavingPrefKey(key);
    updateAccountProfile({ notificationPrefs: { [key]: checked } })
      .then((dto) => setProfile(dto))
      .catch((err: unknown) => {
        setProfile(previous);
        toast.error(err instanceof Error ? err.message : 'Could not save the preference.');
      })
      .finally(() => setSavingPrefKey(null));
  };

  // --- Language preference (optimistic select) --------------------------------

  const [savingLocale, setSavingLocale] = useState(false);

  const handleLocaleChange = (locale: LocaleValue) => {
    if (!profile || savingLocale || profile.profile.locale === locale) return;
    const previous = profile;
    setProfile({
      ...profile,
      profile: { ...profile.profile, locale },
    });
    setSavingLocale(true);
    updateAccountProfile({ locale })
      .then((dto) => setProfile(dto))
      .catch((err: unknown) => {
        setProfile(previous);
        toast.error(err instanceof Error ? err.message : 'Could not save the language.');
      })
      .finally(() => setSavingLocale(false));
  };

  // --- Password change ---------------------------------------------------------

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const handlePasswordChange = () => {
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('The new password must be different from the current password.');
      return;
    }
    if (newPassword.length < ACCOUNT_PASSWORD_MIN_LENGTH) {
      setPasswordError(`Password must be at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setChangingPassword(true);
    changeAccountPassword({ currentPassword, newPassword })
      .then((result) => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        toast.success('Password updated', {
          description:
            result.sessionsRevoked > 0
              ? `${result.sessionsRevoked} other session${result.sessionsRevoked === 1 ? '' : 's'} signed out.`
              : 'No other active sessions to sign out.',
        });
      })
      .catch((err: unknown) => {
        setPasswordError(err instanceof Error ? err.message : 'Could not change the password.');
      })
      .finally(() => setChangingPassword(false));
  };

  // --- Data export --------------------------------------------------------------

  const [exporting, setExporting] = useState(false);

  const handleExport = () => {
    if (exporting) return;
    setExporting(true);
    exportAccountData()
      .then(() => toast.success('Your data export has been downloaded'))
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Could not export your data.');
      })
      .finally(() => setExporting(false));
  };

  // --- Danger zone (deletion) ----------------------------------------------------

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmationMatches = deleteConfirmation === DELETION_WORD;

  const handleDeleteAccount = () => {
    if (!confirmationMatches || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    deleteAccount({ confirmation: deleteConfirmation })
      .then(() => {
        toast.success('Your account has been deleted');
        setDeleteOpen(false);
        // Server revoked every session and cleared the cookie; sign the
        // client out too so cached session state resets, then leave.
        return authClient.signOut().then(() => router.replace('/login'));
      })
      .catch((err: unknown) => {
        setDeleteError(err instanceof Error ? err.message : 'Could not delete the account.');
      })
      .finally(() => setDeleting(false));
  };

  // --- Derived display values ----------------------------------------------------

  const displayName = isEditing ? draftName : profile?.profile.displayName ?? profile?.name ?? '';
  const email = session?.user.email ?? profile?.email ?? '';
  const emailVerified = session?.user.emailVerified ?? profile?.emailVerified ?? false;
  const initials = getInitials(displayName || 'DTG User');

  const preferenceRows: Array<{ key: NotificationPrefKey; label: string; description: string }> = [
    {
      key: 'emailNotifications',
      label: 'Email Notifications',
      description: 'Receive email notifications for important updates',
    },
    {
      key: 'courseUpdates',
      label: 'Course Updates',
      description: 'Get notified when enrolled courses are updated',
    },
    {
      key: 'newContent',
      label: 'New Content Alerts',
      description: 'Be the first to know about new courses and content',
    },
    {
      key: 'promotionalEmails',
      label: 'Promotional Emails',
      description: 'Receive offers, discounts, and promotional content',
    },
  ];

  return (
    <StudentLayout>
      <div className='max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6'>
        {/* Page Header */}
        <div>
          <h1 className='text-2xl font-bold'>Profile &amp; Settings</h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            Manage your account information and preferences
          </p>
        </div>

        {loading ? (
          <ProfileSkeleton />
        ) : error ? (
          error.sessionExpired ? (
            /* 401 — the layout guard redirects on hard navigation; this panel
               covers an expired session while the page is already open. */
            <div className='text-center py-16'>
              <div className='size-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center mb-4'>
                <LogIn className='size-7 text-amber-600' />
              </div>
              <h3 className='font-semibold text-lg mb-1'>Session expired</h3>
              <p className='text-sm text-muted-foreground mb-4 max-w-sm mx-auto'>
                Your session has expired. Sign in again to manage your profile.
              </p>
              <Button asChild>
                <Link href='/login'>Sign in</Link>
              </Button>
            </div>
          ) : (
            <FetchErrorState
              title="Couldn't load your profile"
              message={error.message}
              onRetry={() => setRetrySeed((s) => s + 1)}
            />
          )
        ) : profile ? (
          <motion.div
            variants={container}
            initial='hidden'
            animate='show'
            className='grid gap-6'
          >
            {/* Profile Information */}
            <motion.div variants={item}>
              <Card>
                <CardHeader>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                      <CardTitle className='text-lg'>Profile Information</CardTitle>
                      <CardDescription>Your personal details and public profile</CardDescription>
                    </div>
                    <div className='flex gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={handleExport}
                        disabled={exporting}
                        className='gap-1.5'
                      >
                        {exporting ? (
                          <Loader2 className='size-3.5 animate-spin' />
                        ) : (
                          <Download className='size-3.5' />
                        )}
                        Download my data
                      </Button>
                      {!isEditing ? (
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={startEditing}
                          className='gap-1.5'
                        >
                          <Pencil className='size-3.5' />
                          Edit
                        </Button>
                      ) : (
                        <div className='flex gap-2'>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={cancelEditing}
                            disabled={savingProfile}
                          >
                            Cancel
                          </Button>
                          <Button
                            size='sm'
                            onClick={handleSaveProfile}
                            disabled={savingProfile}
                            className='gap-1.5'
                          >
                            {savingProfile ? (
                              <Loader2 className='size-3.5 animate-spin' />
                            ) : (
                              <Check className='size-3.5' />
                            )}
                            Save
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='space-y-6'>
                  {/* Avatar & Quick Info */}
                  <div className='flex flex-col sm:flex-row items-start sm:items-center gap-4'>
                    <div className='size-20 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0'>
                      <span className='text-2xl font-bold text-primary'>{initials}</span>
                    </div>
                    <div className='flex-1'>
                      <h3 className='text-lg font-semibold'>{displayName || '—'}</h3>
                      <p className='text-sm text-muted-foreground flex items-center gap-1.5'>
                        <Mail className='size-3.5' />
                        {email || '—'}
                      </p>
                      <div className='flex flex-wrap gap-2 mt-2'>
                        <Badge variant='secondary' className='gap-1'>
                          <BookOpen className='size-3' />
                          {profile.stats.enrolmentCount} Courses
                        </Badge>
                        <Badge variant='secondary' className='gap-1'>
                          <Shield className='size-3' />
                          {profile.stats.certificateCount} Certificates
                        </Badge>
                        <Badge variant='secondary' className='gap-1'>
                          <Calendar className='size-3' />
                          Joined {formatDate(profile.joinedAt)}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Form Fields */}
                  <div className='grid sm:grid-cols-2 gap-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='name' className='text-sm font-medium'>
                        Full Name
                      </Label>
                      {isEditing ? (
                        <Input
                          id='name'
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          maxLength={120}
                          autoComplete='name'
                          className='max-w-sm'
                        />
                      ) : (
                        <div className='flex items-center gap-2 text-sm'>
                          <User className='size-4 text-muted-foreground' />
                          {profile.profile.displayName}
                        </div>
                      )}
                    </div>

                    <div className='space-y-2'>
                      <Label htmlFor='email' className='text-sm font-medium'>
                        Email Address
                      </Label>
                      <div className='flex items-center gap-2 text-sm flex-wrap'>
                        <Mail className='size-4 text-muted-foreground' />
                        {email || '—'}
                        {emailVerified && (
                          <Badge variant='outline' className='text-xs'>
                            Verified
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className='space-y-2'>
                      <Label htmlFor='country' className='text-sm font-medium'>
                        Country (2-letter code)
                      </Label>
                      {isEditing ? (
                        <Input
                          id='country'
                          value={draftCountry}
                          onChange={(e) => setDraftCountry(e.target.value)}
                          placeholder='e.g. NG'
                          maxLength={2}
                          className='max-w-sm uppercase'
                        />
                      ) : (
                        <div className='flex items-center gap-2 text-sm'>
                          <MapPin className='size-4 text-muted-foreground' />
                          {profile.profile.countryCode || 'Not set'}
                        </div>
                      )}
                    </div>

                    <div className='space-y-2'>
                      <Label htmlFor='locale-view' className='text-sm font-medium'>
                        Language
                      </Label>
                      {isEditing ? (
                        <Select
                          value={draftLocale}
                          onValueChange={(value) => setDraftLocale(value as LocaleValue)}
                        >
                          <SelectTrigger id='locale-view' className='max-w-sm'>
                            <SelectValue placeholder='Select a language' />
                          </SelectTrigger>
                          <SelectContent>
                            {LOCALES.map((code) => (
                              <SelectItem key={code} value={code}>
                                {LOCALE_LABELS[code]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className='flex items-center gap-2 text-sm'>
                          <Globe className='size-4 text-muted-foreground' />
                          {LOCALE_LABELS[profile.profile.locale] ?? profile.profile.locale}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bio */}
                  <div className='space-y-2'>
                    <Label htmlFor='bio' className='text-sm font-medium'>
                      Bio
                    </Label>
                    {isEditing ? (
                      <>
                        <Textarea
                          id='bio'
                          value={draftBio}
                          onChange={(e) => setDraftBio(e.target.value)}
                          placeholder='Tell us about yourself...'
                          maxLength={1000}
                          className='min-h-[100px] resize-y'
                        />
                        <p className='text-xs text-muted-foreground'>
                          Avatar upload available once media storage is configured
                        </p>
                      </>
                    ) : (
                      <p className='text-sm text-muted-foreground leading-relaxed'>
                        {profile.profile.bio || 'No bio added yet.'}
                      </p>
                    )}
                  </div>

                  <InlineError message={profileError} />
                </CardContent>
              </Card>
            </motion.div>

            {/* Notification Preferences */}
            <motion.div variants={item}>
              <Card>
                <CardHeader>
                  <CardTitle className='text-lg flex items-center gap-2'>
                    <Bell className='size-5 text-primary' />
                    Notification Preferences
                  </CardTitle>
                  <CardDescription>Choose what notifications you want to receive</CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  {preferenceRows.map((row, index) => (
                    <React.Fragment key={row.key}>
                      {index > 0 && <Separator />}
                      <div className='flex items-center justify-between gap-4'>
                        <div className='space-y-0.5'>
                          <p className='text-sm font-medium'>{row.label}</p>
                          <p className='text-xs text-muted-foreground'>{row.description}</p>
                        </div>
                        <div className='flex items-center gap-2'>
                          {savingPrefKey === row.key && (
                            <span className='text-xs text-muted-foreground'>Saving…</span>
                          )}
                          <Switch
                            aria-label={row.label}
                            checked={profile.profile.notificationPrefs[row.key]}
                            disabled={savingPrefKey === row.key}
                            onCheckedChange={(checked) => handlePrefToggle(row.key, checked)}
                          />
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </CardContent>
              </Card>
            </motion.div>

            {/* Language Preference */}
            <motion.div variants={item}>
              <Card>
                <CardHeader>
                  <CardTitle className='text-lg flex items-center gap-2'>
                    <Globe className='size-5 text-primary' />
                    Language Preference
                  </CardTitle>
                  <CardDescription>Set your preferred language for the platform</CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    role='radiogroup'
                    aria-label='Language preference'
                    className='grid sm:grid-cols-3 gap-3'
                  >
                    {LOCALES.map((code) => {
                      const active = profile.profile.locale === code;
                      return (
                        <button
                          key={code}
                          type='button'
                          role='radio'
                          aria-checked={active}
                          disabled={savingLocale}
                          onClick={() => handleLocaleChange(code)}
                          className={`p-3 rounded-lg border text-sm font-medium transition-all text-left disabled:opacity-70 ${
                            active
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-border hover:border-primary/50 hover:bg-muted'
                          }`}
                        >
                          {LOCALE_LABELS[code]}
                        </button>
                      );
                    })}
                  </div>
                  {savingLocale && (
                    <p className='text-xs text-muted-foreground mt-2'>Saving…</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Password Change */}
            <motion.div variants={item}>
              <Card>
                <CardHeader>
                  <CardTitle className='text-lg flex items-center gap-2'>
                    <Lock className='size-5 text-primary' />
                    Change Password
                  </CardTitle>
                  <CardDescription>
                    Update your password. Other signed-in devices are logged out.
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <PasswordField
                    id='current-password'
                    label='Current Password'
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    autoComplete='current-password'
                  />
                  <PasswordField
                    id='new-password'
                    label='New Password'
                    value={newPassword}
                    onChange={setNewPassword}
                    autoComplete='new-password'
                  />
                  <p className='text-xs text-muted-foreground -mt-2'>
                    At least {ACCOUNT_PASSWORD_MIN_LENGTH} characters.
                  </p>
                  <PasswordField
                    id='confirm-password'
                    label='Confirm New Password'
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete='new-password'
                  />
                  <InlineError message={passwordError} />
                  <Button
                    className='mt-2'
                    onClick={handlePasswordChange}
                    disabled={
                      changingPassword || !currentPassword || !newPassword || !confirmPassword
                    }
                  >
                    {changingPassword ? (
                      <>
                        <Loader2 className='size-4 animate-spin' />
                        Updating…
                      </>
                    ) : (
                      'Update Password'
                    )}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Danger Zone */}
            <motion.div variants={item}>
              <Card className='border-destructive/30'>
                <CardHeader>
                  <CardTitle className='text-lg text-destructive'>Danger Zone</CardTitle>
                  <CardDescription>Irreversible actions for your account</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
                    <div>
                      <p className='text-sm font-medium'>Delete Account</p>
                      <p className='text-xs text-muted-foreground'>
                        Permanently anonymize your account. Financial and course records are kept
                        for integrity; your personal data is removed.
                      </p>
                    </div>
                    <Button
                      variant='destructive'
                      size='sm'
                      onClick={() => {
                        setDeleteConfirmation('');
                        setDeleteError(null);
                        setDeleteOpen(true);
                      }}
                    >
                      Delete Account
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        ) : null}

        {/* Deletion confirmation dialog */}
        <AlertDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (!deleting) setDeleteOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently anonymizes your account and signs you out everywhere. Type{' '}
                <span className='font-semibold text-foreground'>{DELETION_WORD}</span> to confirm.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className='space-y-2'>
              <Label htmlFor='delete-confirmation' className='text-sm font-medium'>
                Confirmation
              </Label>
              <Input
                id='delete-confirmation'
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder={DELETION_WORD}
                autoComplete='off'
                aria-invalid={deleteConfirmation.length > 0 && !confirmationMatches}
              />
              <InlineError message={deleteError} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <Button
                variant='destructive'
                onClick={handleDeleteAccount}
                disabled={!confirmationMatches || deleting}
              >
                {deleting ? (
                  <>
                    <Loader2 className='size-4 animate-spin' />
                    Deleting…
                  </>
                ) : (
                  'Delete my account'
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </StudentLayout>
  );
}
