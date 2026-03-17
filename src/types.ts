/**
 * Shared types for WebSocket server
 */

// --- Auth ---

export interface AuthUser {
  id: string;
  username: string;
  isSupport: boolean;
}

export interface VerifyTokenResponse {
  valid: boolean;
  user?: AuthUser;
  error?: string;
}

export interface VerifyTicketAccessResponse {
  allowed: boolean;
}

// --- Socket Data ---

export interface SocketData {
  user: AuthUser;
  userId: string;
  isSupport: boolean;
}

// --- WebSocket Events ---

export interface AckResponse {
  ok: boolean;
  error?: string;
}

export interface WebSocketEvents {
  // Client -> Server
  'support:join': (
    data: { ticketId: string },
    ack: (response: AckResponse) => void,
  ) => void;
  'support:leave': (data: { ticketId: string }) => void;
  'support:typing': (data: { ticketId: string; isTyping: boolean }) => void;

  // Server -> Client
  'support:message:new': (data: { ticketId: string; message: SupportMessage }) => void;
  'support:ticket:updated': (data: { ticketId: string; ticket: TicketUpdate }) => void;
  'support:ticket:assigned': (data: {
    ticketId: string;
    assignedTo: string | null;
    assignedUser: UserProfile | null;
  }) => void;
  'support:typing:status': (data: {
    ticketId: string;
    userId: string;
    username: string;
    isTyping: boolean;
  }) => void;
  'support:message:read': (data: {
    ticketId: string;
    messageIds: string[];
    readBy: 'user' | 'support';
  }) => void;
  'support:error': (data: { message: string; code?: string }) => void;

  // Profile Comments
  'profile:join': (data: { profileId: string }) => void;
  'profile:leave': (data: { profileId: string }) => void;
  'profile:comment:new': (data: { profileId: string; comment: ProfileComment }) => void;
}

// --- Data Shapes ---

export interface UserProfile {
  id: string;
  username: string;
  user_id: string;
  avatar?: string | null;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_type: 'user' | 'support';
  message_text: string;
  is_read: boolean;
  created_at: string;
  sender?: UserProfile;
  attachments?: Array<{
    id: string;
    file_name: string;
    file_type: string;
    file_size: number;
    storage_path: string;
    storage_url?: string;
  }>;
}

export interface TicketUpdate {
  id: string;
  status: 'open' | 'closed' | 'pending';
  assigned_to?: string | null;
  updated_at: string;
  closed_at?: string | null;
}

export interface ProfileComment {
  id: string;
  profile_id: string;
  author_id: string;
  parent_id?: string | null;
  content: string;
  is_pinned: boolean;
  created_at: string;
  author: UserProfile;
}

// --- Broadcast Payloads (REST API from rvn-web) ---

export interface BroadcastMessagePayload {
  ticketId: string;
  message: SupportMessage;
}

export interface BroadcastTicketUpdatePayload {
  ticketId: string;
  ticket: TicketUpdate;
}

export interface BroadcastTicketAssignedPayload {
  ticketId: string;
  assignedTo: string | null;
  assignedUser: UserProfile | null;
}

export interface BroadcastMessageReadPayload {
  ticketId: string;
  messageIds: string[];
  readBy: 'user' | 'support';
}

export interface BroadcastCommentPayload {
  profileId: string;
  comment: ProfileComment;
}
