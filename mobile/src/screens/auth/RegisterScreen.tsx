import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { useAuthStore } from '../../store/auth';
import { KeyboardSafeView } from '../../components/KeyboardSafeView';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { theme } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export const RegisterScreen: React.FC<Props> = ({ navigation }) => {
  const { register, isLoading, error: serverError, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [clientErrors, setClientErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  const validate = (): boolean => {
    const errors: { email?: string; password?: string; confirmPassword?: string } = {};

    const trimmedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail) {
      errors.email = 'Email is required';
    } else if (!emailRegex.test(trimmedEmail)) {
      errors.email = 'Invalid email address format';
    } else if (trimmedEmail.length > 254) {
      errors.email = 'Email cannot exceed 254 characters';
    }

    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters long';
    } else if (password.length > 128) {
      errors.password = 'Password cannot exceed 128 characters';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Confirm your password';
    } else if (confirmPassword !== password) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleRegister = async () => {
    clearError();
    if (!validate()) {
      return;
    }

    try {
      await register(email, password);
    } catch {
      // Error handled by store
    }
  };

  return (
    <KeyboardSafeView>
      <View style={styles.header}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Get started with Modulus Todo</Text>
      </View>

      {serverError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{serverError}</Text>
        </View>
      ) : null}

      <Input
        label="Email Address"
        placeholder="name@example.com"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          if (clientErrors.email) setClientErrors((prev) => ({ ...prev, email: undefined }));
        }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        error={clientErrors.email}
      />

      <Input
        label="Password"
        placeholder="At least 8 characters"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          if (clientErrors.password) setClientErrors((prev) => ({ ...prev, password: undefined }));
        }}
        secureTextEntry
        autoCapitalize="none"
        error={clientErrors.password}
      />

      <Input
        label="Confirm Password"
        placeholder="Repeat your password"
        value={confirmPassword}
        onChangeText={(text) => {
          setConfirmPassword(text);
          if (clientErrors.confirmPassword) {
            setClientErrors((prev) => ({ ...prev, confirmPassword: undefined }));
          }
        }}
        secureTextEntry
        autoCapitalize="none"
        error={clientErrors.confirmPassword}
      />

      <Button
        title="Create Account"
        loading={isLoading}
        onPress={handleRegister}
        style={styles.submitButton}
      />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account? </Text>
        <TouchableOpacity
          onPress={() => {
            clearError();
            navigation.navigate('Login');
          }}
        >
          <Text style={styles.linkText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    </KeyboardSafeView>
  );
};

const styles = StyleSheet.create({
  header: {
    marginBottom: theme.spacing.xl,
    alignItems: 'center',
  },
  title: {
    ...theme.typography.h1,
    color: theme.colors.primaryLight,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  errorBanner: {
    backgroundColor: theme.colors.errorBackground,
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  errorBannerText: {
    ...theme.typography.bodySmall,
    color: theme.colors.error,
    textAlign: 'center',
  },
  submitButton: {
    marginTop: theme.spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: theme.spacing.xl,
  },
  footerText: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
  },
  linkText: {
    ...theme.typography.bodySmall,
    color: theme.colors.primaryLight,
    fontWeight: '700',
  },
});
