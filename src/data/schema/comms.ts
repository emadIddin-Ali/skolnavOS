import { z } from 'zod'
import { zId, zIso, sensitiveBase } from './base'

export const conversationSchema = z.object({
  ...sensitiveBase,
  id: zId,
  subject: z.string(),
  kind: z.enum(['direkt', 'vh_larare', 'personal', 'klass', 'avdelning']),
  memberUserIds: z.array(zId).default([]),
  studentId: zId.nullable().default(null),
  lastMessageAt: zIso,
  unread: z.number().int().default(0),
  archived: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
})
export type Conversation = z.infer<typeof conversationSchema>

export const messageSchema = z.object({
  id: zId,
  conversationId: zId,
  senderUserId: zId,
  body: z.string(),
  sentAt: zIso,
  readBy: z.array(zId).default([]),
  confirmed: z.boolean().default(false),
  attachmentIds: z.array(zId).default([]),
})
export type Message = z.infer<typeof messageSchema>

export const announcementSchema = z.object({
  ...sensitiveBase,
  id: zId,
  title: z.string(),
  body: z.string(),
  audience: z.enum(['skola', 'klass', 'personal', 'vardnadshavare', 'organisation']),
  urgent: z.boolean().default(false),
  publishedBy: zId,
  publishedAt: zIso,
  scheduledFor: zIso.nullable().default(null),
  confirmationsRequired: z.boolean().default(false),
})
export type Announcement = z.infer<typeof announcementSchema>

/** Pedagogisk dokumentation (förskola/fritids/lärlogg). */
export const documentationPostSchema = z.object({
  ...sensitiveBase,
  id: zId,
  title: z.string(),
  body: z.string(),
  studentIds: z.array(zId).default([]),
  classId: zId.nullable().default(null),
  authorUserId: zId,
  visibleToGuardians: z.boolean().default(true),
  postedAt: zIso,
})
export type DocumentationPost = z.infer<typeof documentationPostSchema>

export const notificationChannelEnum = z.enum(['app', 'push', 'epost', 'sms', 'digest'])
export type NotificationChannel = z.infer<typeof notificationChannelEnum>

export const notificationSchema = z.object({
  id: zId,
  userId: zId,
  organizationId: zId,
  title: z.string(),
  body: z.string(),
  category: z.enum(['franvaro', 'meddelande', 'samtycke', 'schema', 'sakerhet', 'system', 'rapport']),
  channel: notificationChannelEnum.default('app'),
  urgent: z.boolean().default(false),
  read: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
  confirmedAt: zIso.nullable().default(null),
  deliveryStatus: z.enum(['köad', 'skickad', 'levererad', 'misslyckad', 'batchad']).default('levererad'),
  createdAt: zIso,
})
export type NotificationItem = z.infer<typeof notificationSchema>

export const notificationPreferenceSchema = z.object({
  userId: zId,
  category: z.string(),
  channels: z.array(notificationChannelEnum),
  digest: z.boolean().default(false),
  quietHoursStart: z.string().nullable().default(null),
  quietHoursEnd: z.string().nullable().default(null),
})
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>
