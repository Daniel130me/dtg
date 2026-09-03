'use client';

import React, { useEffect, useState } from 'react';
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
  AtSign,
  ShieldCheck,
  Download,
  Loader2,
  Settings,
} from 'lucide-react';
import InstructorLayout from './InstructorLayout';
import {
  changeAccountEmail,
  changeAccountPassword,
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

// Owner account settings: profile identity, email change (behind a
// current-password check), password rotation, and preferences. Mirrors the
// student ProfilePage's structure and request-key loading pattern, but framed
// for the platform owner — no student stats, and NO danger zone (the server
// refuses owner self-deletion).

// --- Motion presets (same as the student profile page) -----------------------

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

const LOCALE_LABELS: Record<LocaleValue, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
};

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

function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role='alert' className='text-sm text-destructive'>
      {message}
    </p>
  );
}

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

function SettingsSkeleton() {
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
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className='space-y-2'>
              <Skeleton className='h-3.5 w-40' />
              <Skeleton className='h-9 w-full max-w-md' />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// Loose client-side shape check; the server contract is the authority.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Page ---------------------------------------------------------------------

export default function OwnerSettingsPage() {
  const [profile, setProfile] = useState<AccountProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);

  // Request-key pattern: loading is DERIVED, every setState lives in an async
  // callback or an event handler.
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
        setError(err instanceof Error ? err.message : 'Failed to load your account.');
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

  // --- Email change ------------------------------------------------------------

  const [emailPassword, setEmailPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const handleEmailChange = () => {
    setEmailError(null);
    const email = newEmail.trim().toLowerCase();
    if (!emailPassword || !email) {
      setEmailError('Enter your current password and the new email address.');
      return;
    }
    if (!EMAIL_SHAPE.test(email)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    if (email !== confirmEmail.trim().toLowerCase()) {
      setEmailError('The email addresses do not match.');
      return;
    }
    if (profile && email === profile.email.trim().toLowerCase()) {
      setEmailError('The new email must be different from the current email.');
      return;
    }
    setChangingEmail(true);
    changeAccountEmail({ currentPassword: emailPassword, newEmail: email })
      .then(() => {
        setEmailPassword('');
        setNewEmail('');
        setConfirmEmail('');
        toast.success('Verification email requested', {
          description: `Open the link sent to ${email} to complete the change. Your current email remains active until then.`,
        });
      })
      .catch((err: unknown) => {
        setEmailError(err instanceof Error ? err.message : 'Could not change the email address.');
      })
      .finally(() => setChangingEmail(false));
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

  // --- Preferences (optimistic toggles + language) -----------------------------

  const [savingPrefKey, setSavingPrefKey] = useState<NotificationPrefKey | null>(null);

  const handlePrefToggle = (key: NotificationPrefKey, checked: boolean) => {
    if (!profile || savingPrefKey === key) return;
    const previous = profile;
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

  // --- Derived display values ----------------------------------------------------

  const displayName = isEditing ? draftName : profile?.profile.displayName ?? profile?.name ?? '';
  const email = profile?.email ?? '';
  const emailVerified = profile?.emailVerified ?? false;
  const initials = getInitials(displayName || 'DTG Owner');

  const preferenceRows: Array<{ key: NotificationPrefKey; label: string; description: string }> = [
    {
      key: 'emailNotifications',
      label: 'Email Notifications',
      description: 'Receive email notifications for important updates',
    },
    {
      key: 'courseUpdates',
      label: 'Course Updates',
      description: 'Get notified when courses are updated',
    },
    {
      key: 'newContent',
      label: 'New Content Alerts',
      description: 'Be notified when new courses and content are published',
    },
    {
      key: 'promotionalEmails',
      label: 'Promotional Emails',
      description: 'Receive offers, discounts, and promotional content',
    },
  ];

  return (
    <InstructorLayout>
      <div className='max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6'>
        {/* Page Header */}
        <div className='flex items-start gap-3'>
          <div className='size-10 rounded-lg bg-primary flex items-center justify-center shrink-0'>
            <Settings className='size-5 text-primary-foreground' />
          </div>
          <div>
            <h1 className='text-2xl font-bold'>Account Settings</h1>
            <p className='text-muted-foreground mt-1 text-sm'>
              Manage your owner account, email, and security
            </p>
          </div>
        </div>

        {loading ? (
          <SettingsSkeleton />
        ) : error ? (
          <Card>
            <CardContent className='py-14 text-center'>
              <div className='size-14 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-4'>
                <Settings className='size-6 text-destructive' />
              </div>
              <h3 className='font-semibold mb-1'>Could not load your account</h3>
              <p className='text-sm text-muted-foreground mb-4 max-w-sm mx-auto'>{error}</p>
              <Button variant='outline' onClick={() => setRetrySeed((s) => s + 1)} className='gap-1.5'>
                Try Again
              </Button>
            </CardContent>
          </Card>
        ) : profile ? (
          <motion.div variants={container} initial='hidden' animate='show' className='grid gap-6'>
            {/* Profile Information */}
            <motion.div variants={item}>
              <Card>
                <CardHeader>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                      <CardTitle className='text-lg'>Profile Information</CardTitle>
                      <CardDescription>Your identity on the platform</CardDescription>
                    </div>
                    <div className='flex gap-2'>
                      <Button variant='outline' size='sm' onClick={handleExport} disabled={exporting} className='gap-1.5'>
                        {exporting ? (
                          <Loader2 className='size-3.5 animate-spin' />
                        ) : (
                          <Download className='size-3.5' />
                        )}
                        Download my data
                      </Button>
                      {!isEditing ? (
                        <Button variant='outline' size='sm' onClick={startEditing} className='gap-1.5'>
                          <Pencil className='size-3.5' />
                          Edit
                        </Button>
                      ) : (
                        <div className='flex gap-2'>
                          <Button variant='ghost' size='sm' onClick={cancelEditing} disabled={savingProfile}>
                            Cancel
                          </Button>
                          <Button size='sm' onClick={handleSaveProfile} disabled={savingProfile} className='gap-1.5'>
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
                          <ShieldCheck className='size-3' />
                          Platform Owner
                        </Badge>
                        <Badge variant='outline' className='gap-1'>
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
                        {emailVerified ? (
                          <Badge variant='outline' className='text-xs'>
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant='outline' className='text-xs text-amber-700 dark:text-amber-400 border-amber-500/40'>
                            Unverified
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
                        <Select value={draftLocale} onValueChange={(value) => setDraftLocale(value as LocaleValue)}>
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
                      <Textarea
                        id='bio'
                        value={draftBio}
                        onChange={(e) => setDraftBio(e.target.value)}
                        placeholder='Tell your learners about yourself...'
                        maxLength={1000}
                        className='min-h-[100px] resize-y'
                      />
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

            {/* Email Change */}
            <motion.div variants={item}>
              <Card>
                <CardHeader>
                  <CardTitle className='text-lg flex items-center gap-2'>
                    <AtSign className='size-5 text-primary' />
                    Change Email
                  </CardTitle>
                  <CardDescription>
                    Confirm your password, then set a new address. The new address must be
                    verified before your next sign-in.
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <PasswordField
                    id='email-password'
                    label='Current Password'
                    value={emailPassword}
                    onChange={setEmailPassword}
                    autoComplete='current-password'
                  />
                  <div className='space-y-2 max-w-md'>
                    <Label htmlFor='new-email' className='text-sm font-medium'>
                      New Email Address
                    </Label>
                    <Input
                      id='new-email'
                      type='email'
                      autoComplete='email'
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder='you@example.com'
                    />
                  </div>
                  <div className='space-y-2 max-w-md'>
                    <Label htmlFor='confirm-email' className='text-sm font-medium'>
                      Confirm New Email Address
                    </Label>
                    <Input
                      id='confirm-email'
                      type='email'
                      autoComplete='off'
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                      placeholder='you@example.com'
                    />
                  </div>
                  <InlineError message={emailError} />
                  <Button
                    className='mt-2'
                    onClick={handleEmailChange}
                    disabled={changingEmail || !emailPassword || !newEmail || !confirmEmail}
                  >
                    {changingEmail ? (
                      <>
                        <Loader2 className='size-4 animate-spin' />
                        Updating…
                      </>
                    ) : (
                      'Update Email'
                    )}
                  </Button>
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
                    disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
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
                  <div role='radiogroup' aria-label='Language preference' className='grid sm:grid-cols-3 gap-3'>
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
                  {savingLocale && <p className='text-xs text-muted-foreground mt-2'>Saving…</p>}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        ) : null}
      </div>
    </InstructorLayout>
  );
}
