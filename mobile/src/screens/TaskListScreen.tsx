import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../navigation/types';
import { useTasksStore, StatusFilter, SortOption } from '../store/tasks';
import { useAuthStore } from '../store/auth';
import { TaskCard } from '../components/TaskCard';
import { Task } from '../api/tasks';
import { theme } from '../theme';
import { isOverdue } from '../utils/date';

type Props = NativeStackScreenProps<AppStackParamList, 'TaskList'>;

export const TaskListScreen: React.FC<Props> = ({ navigation }) => {
  const { user, logout } = useAuthStore();
  const {
    tasks,
    isLoading,
    isRefreshing,
    isLoadingMore,
    isWakingServer,
    error,
    statusFilter,
    sortBy,
    setStatusFilter,
    setSortBy,
    setSearchQuery,
    loadTasks,
    loadMoreTasks,
    toggleCompletion,
    deleteTask,
    clearError,
  } = useTasksStore();

  const [localSearch, setLocalSearch] = useState('');

  // Initial load
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Debounced search (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchQuery(localSearch);
    }, 300);
    return () => clearTimeout(handler);
  }, [localSearch, setSearchQuery]);

  // Derived metrics
  const { pendingCount, overdueCount } = useMemo(() => {
    let pending = 0;
    let overdue = 0;
    tasks.forEach((t) => {
      if (!t.completed) {
        pending++;
        if (isOverdue(t.deadline, t.completed)) {
          overdue++;
        }
      }
    });
    return { pendingCount: pending, overdueCount: overdue };
  }, [tasks]);

  const handleEditTask = (task: Task) => {
    navigation.navigate('TaskForm', { task });
  };

  const handleCreateTask = () => {
    navigation.navigate('TaskForm', undefined);
  };

  const renderFilterChip = (filter: StatusFilter, label: string) => {
    const isSelected = statusFilter === filter;
    return (
      <TouchableOpacity
        key={filter}
        style={[styles.filterChip, isSelected && styles.filterChipActive]}
        onPress={() => setStatusFilter(filter)}
        activeOpacity={0.7}
      >
        <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderSortChip = (sort: SortOption, label: string) => {
    const isSelected = sortBy === sort;
    return (
      <TouchableOpacity
        key={sort}
        style={[styles.sortChip, isSelected && styles.sortChipActive]}
        onPress={() => setSortBy(sort)}
        activeOpacity={0.7}
      >
        <Text style={[styles.sortChipText, isSelected && styles.sortChipTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View>
            <Text style={styles.greetingTitle}>Modulus Todo</Text>
            <Text style={styles.userEmail}>{user?.email || 'User'}</Text>
          </View>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => logout()}
            activeOpacity={0.7}
          >
            <Text style={styles.logoutButtonText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        {/* Count Metric Pills */}
        <View style={styles.metricsRow}>
          <View style={styles.metricPill}>
            <Text style={styles.metricNumber}>{pendingCount}</Text>
            <Text style={styles.metricLabel}>Pending</Text>
          </View>
          <View style={[styles.metricPill, overdueCount > 0 && styles.metricPillOverdue]}>
            <Text style={[styles.metricNumber, overdueCount > 0 && styles.metricNumberOverdue]}>
              {overdueCount}
            </Text>
            <Text style={[styles.metricLabel, overdueCount > 0 && styles.metricLabelOverdue]}>
              Overdue
            </Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search tasks..."
            placeholderTextColor={theme.colors.textMuted}
            value={localSearch}
            onChangeText={setLocalSearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          {localSearch ? (
            <TouchableOpacity onPress={() => setLocalSearch('')} style={styles.searchClear}>
              <Text style={styles.searchClearText}>×</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Filter Chips */}
        <View style={styles.chipsRow}>
          {renderFilterChip('all', 'All')}
          {renderFilterChip('pending', 'Pending')}
          {renderFilterChip('completed', 'Completed')}
        </View>

        {/* Sort Chips */}
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort by:</Text>
          {renderSortChip('urgency', 'Urgency')}
          {renderSortChip('deadline', 'Deadline')}
          {renderSortChip('priority', 'Priority')}
          {renderSortChip('createdAt', 'Newest')}
        </View>
      </View>

      {/* Render Server Wake-Up Notice if cold-starting (>5s) */}
      {isWakingServer ? (
        <View style={styles.wakeNotice}>
          <ActivityIndicator size="small" color={theme.colors.primaryLight} style={styles.wakeSpinner} />
          <Text style={styles.wakeNoticeText}>
            Waking up the server, this can take up to a minute...
          </Text>
        </View>
      ) : null}

      {/* Error Banner with Retry */}
      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              clearError();
              loadTasks();
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Task List Content */}
      <FlatList
        data={tasks}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            onToggleCompletion={toggleCompletion}
            onPress={handleEditTask}
            onDelete={deleteTask}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadTasks(true)}
            tintColor={theme.colors.primaryLight}
            colors={[theme.colors.primary]}
          />
        }
        onEndReached={loadMoreTasks}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No tasks found</Text>
              <Text style={styles.emptySubtitle}>
                {localSearch
                  ? `No matches found for "${localSearch}"`
                  : 'Tap the + button below to create your first task!'}
              </Text>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={theme.colors.primaryLight} />
            </View>
          ) : undefined
        }
      />

      {/* Floating Action Button (FAB) */}
      <TouchableOpacity
        style={styles.fab}
        onPress={handleCreateTask}
        activeOpacity={0.8}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    backgroundColor: theme.colors.surface,
    paddingTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  greetingTitle: {
    ...theme.typography.h2,
    color: theme.colors.primaryLight,
  },
  userEmail: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  logoutButtonText: {
    ...theme.typography.caption,
    color: theme.colors.error,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: theme.spacing.sm,
  },
  metricPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.colors.surfaceLight,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.borderRadius.md,
  },
  metricPillOverdue: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  metricNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  metricNumberOverdue: {
    color: theme.colors.error,
  },
  metricLabel: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
  },
  metricLabelOverdue: {
    color: theme.colors.error,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.sm + 4,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    color: theme.colors.text,
    fontSize: theme.typography.bodySmall.fontSize,
  },
  searchClear: {
    padding: 4,
  },
  searchClearText: {
    color: theme.colors.textMuted,
    fontSize: 18,
    lineHeight: 18,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: theme.spacing.xs + 2,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceLight,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
  },
  filterChipText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  sortLabel: {
    ...theme.typography.caption,
    color: theme.colors.textMuted,
    marginRight: 2,
  },
  sortChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sortChipActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  },
  sortChipText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  sortChipTextActive: {
    color: theme.colors.primaryLight,
    fontWeight: '700',
  },
  wakeSpinner: {
    marginRight: 8,
  },
  wakeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    padding: theme.spacing.sm + 2,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  wakeNoticeText: {
    ...theme.typography.caption,
    color: theme.colors.primaryLight,
    flex: 1,
  },
  errorContainer: {
    backgroundColor: theme.colors.errorBackground,
    padding: theme.spacing.md,
    margin: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  errorText: {
    ...theme.typography.bodySmall,
    color: theme.colors.error,
    flex: 1,
    marginRight: 8,
  },
  retryButton: {
    backgroundColor: theme.colors.error,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.sm,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  listContent: {
    padding: theme.spacing.md,
    paddingBottom: 90,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    ...theme.typography.h3,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  emptySubtitle: {
    ...theme.typography.bodySmall,
    color: theme.colors.textMuted,
    textAlign: 'center',
    maxWidth: 240,
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  fabIcon: {
    fontSize: 32,
    color: '#FFFFFF',
    lineHeight: 34,
    fontWeight: '300',
  },
});
