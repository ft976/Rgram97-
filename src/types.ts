export type User = {
  id: string;
  name: string;
  avatarUrl: string;
  bio?: string;
};

export type RoomInfo = {
  id: string;
  name: string;
};

export type ChatMessage = {
  id: string;
  userId: string;
  userName: string;
  userAvatarUrl: string;
  text: string;
  imageUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  timestamp: number;
  isDeleted?: boolean;
  hiddenFor?: string[];
  isViewOnce?: boolean;
  isOpened?: boolean;
  replyTo?: {
    id: string;
    userName: string;
    text: string;
    audioUrl?: boolean;
    imageUrl?: boolean;
    videoUrl?: boolean;
  };
};

export type Post = {
  id: string;
  userId: string;
  userName: string;
  userAvatarUrl: string;
  caption: string;
  imageUrl: string;
  likes: number;
  timestamp: number;
};
