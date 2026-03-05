import mongoose, { Schema, models } from "mongoose";

type FileDoc = {
  path: string;
  content: string;
};

export type ShareDoc = {
  shareId: string;
  projectName: string;
  files: FileDoc[];
  updatedAt: Date;
  expiresAt?: Date;
  passwordHash?: string;
};

const FileSchema = new Schema<FileDoc>(
  {
    path: { type: String, required: true },
    content: { type: String, required: true },
  },
  { _id: false }
);

const ShareSchema = new Schema<ShareDoc>(
  {
    shareId: { type: String, required: true, unique: true },
    projectName: { type: String, required: true },
    files: { type: [FileSchema], default: [] },
    expiresAt: { type: Date, required: false },
    passwordHash: { type: String, required: false },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const Share = models.Share || mongoose.model("Share", ShareSchema);
