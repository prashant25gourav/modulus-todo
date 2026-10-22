import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAuthStore } from '../store/auth';
import { Button } from '../components/Button';
import { theme } from '../theme';

export const HomeScreen: React.FC = () => {
  const { user, logout, isLoading } = useAuthStore();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.greeting}>Welcome back,</Text>
        <Text style={styles.email}>{user?.email || 'Authenticated User'}</Text>

        <View style={styles.divider} />

        <Text style={styles.infoTitle}>Session Status</Text>
        <Text style={styles.infoText}>
          Dual-token authentication active with secure Keychain storage.
        </Text>

        <Button
          title="Log Out"
          variant="danger"
          loading={isLoading}
          onPress={() => logout()}
          style={styles.logoutButton}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  greeting: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  email: {
    ...theme.typography.h2,
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
  infoTitle: {
    ...theme.typography.bodySmall,
    fontWeight: '600',
    color: theme.colors.primaryLight,
    marginBottom: theme.spacing.xs,
  },
  infoText: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.lg,
  },
  logoutButton: {
    marginTop: theme.spacing.sm,
  },
});
