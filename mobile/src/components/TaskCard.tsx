import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Task, Priority } from '../api/tasks';
import { theme } from '../theme';
import { formatHumanDeadline, isOverdue } from '../utils/date';

interface TaskCardProps {
  task: Task;
  onToggleCompletion: (id: string) => void;
  onPress: (task: Task) => void;
  onDelete: (id: string) => void;
}

const getPriorityColor = (priority: Priority) => {
  switch (priority) {
    case 'high':
      return { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444', border: '#EF4444' };
    case 'medium':
      return { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B', border: '#F59E0B' };
    case 'low':
      return { bg: 'rgba(59, 130, 246, 0.15)', text: '#3B82F6', border: '#3B82F6' };
    default:
      return { bg: 'rgba(148, 163, 184, 0.15)', text: '#94A3B8', border: '#94A3B8' };
  }
};

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onToggleCompletion,
  onPress,
  onDelete,
}) => {
  const priorityStyle = getPriorityColor(task.priority);
  const overdue = isOverdue(task.deadline, task.completed);

  const confirmDelete = () => {
    Alert.alert(
      'Delete Task',
      `Are you sure you want to delete "${task.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(task._id),
        },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={[
        styles.card,
        task.completed && styles.cardCompleted,
      ]}
      activeOpacity={0.75}
      onPress={() => onPress(task)}
    >
      <View style={styles.cardHeader}>
        {/* Checkbox */}
        <TouchableOpacity
          style={[
            styles.checkbox,
            task.completed && styles.checkboxChecked,
          ]}
          onPress={() => onToggleCompletion(task._id)}
          activeOpacity={0.7}
        >
          {task.completed ? <Text style={styles.checkmark}>✓</Text> : null}
        </TouchableOpacity>

        {/* Title and details */}
        <View style={styles.content}>
          <Text
            style={[
              styles.title,
              task.completed && styles.titleCompleted,
            ]}
            numberOfLines={2}
          >
            {task.title}
          </Text>

          {task.description ? (
            <Text
              style={[
                styles.description,
                task.completed && styles.descriptionCompleted,
              ]}
              numberOfLines={2}
            >
              {task.description}
            </Text>
          ) : null}

          {/* Badges row */}
          <View style={styles.metaRow}>
            {/* Priority Badge */}
            <View
              style={[
                styles.badge,
                { backgroundColor: priorityStyle.bg, borderColor: priorityStyle.border },
              ]}
            >
              <Text style={[styles.badgeText, { color: priorityStyle.text }]}>
                {task.priority.toUpperCase()}
              </Text>
            </View>

            {/* Overdue Badge */}
            {overdue ? (
              <View style={[styles.badge, styles.overdueBadge]}>
                <Text style={styles.overdueText}>OVERDUE</Text>
              </View>
            ) : null}

            {/* Human Deadline */}
            <Text style={[styles.deadlineText, overdue && styles.deadlineOverdue]}>
              {formatHumanDeadline(task.deadline)}
            </Text>
          </View>

          {/* Tags */}
          {task.tags && task.tags.length > 0 ? (
            <View style={styles.tagsContainer}>
              {task.tags.map((tag) => (
                <View key={tag} style={styles.tagChip}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Delete Action Button */}
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={confirmDelete}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.deleteIcon}>×</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardCompleted: {
    opacity: 0.65,
    backgroundColor: '#161F30',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginRight: theme.spacing.sm + 4,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.success,
    borderColor: theme.colors.success,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  content: {
    flex: 1,
  },
  title: {
    ...theme.typography.h3,
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    color: theme.colors.textMuted,
  },
  description: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  descriptionCompleted: {
    color: theme.colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: theme.spacing.sm,
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  overdueBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#EF4444',
  },
  overdueText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  deadlineText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    marginLeft: 2,
  },
  deadlineOverdue: {
    color: theme.colors.error,
    fontWeight: '600',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: theme.spacing.sm,
  },
  tagChip: {
    backgroundColor: theme.colors.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
  },
  deleteButton: {
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  deleteIcon: {
    fontSize: 22,
    color: theme.colors.textMuted,
    lineHeight: 22,
  },
});
