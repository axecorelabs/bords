-- Add is_system_message column to messages table for task assignment evidence
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_system_message BOOLEAN DEFAULT FALSE;

-- Update the migration SQL file with the new column