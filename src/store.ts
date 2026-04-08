import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MessageRecord } from "./types.js";

export class AdapterStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("pragma journal_mode = WAL;");
    this.db.exec("pragma synchronous = NORMAL;");
    this.migrate();
  }

  health() {
    const row = this.db.prepare("select 1 as ok").get() as { ok: number };
    return row.ok === 1;
  }

  getByMessageId(messageId: string): MessageRecord | null {
    const row = this.db
      .prepare("select * from inbound_messages where message_id = ?")
      .get(messageId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  insertReceived(params: {
    messageId: string;
    eventId: string;
    employeeId: string;
    agentId: string;
    sessionKey: string;
    conversationId: string;
    threadId: string | null;
    conversationType: string;
  }): MessageRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into inbound_messages (
          message_id, event_id, employee_id, agent_id, session_key,
          conversation_id, thread_id, conversation_type,
          request_id, chatroom_id, chatmsg_id, run_id,
          status, error_code, error_message, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, null, null, null, null, 'received', null, null, ?, ?)`,
      )
      .run(
        params.messageId,
        params.eventId,
        params.employeeId,
        params.agentId,
        params.sessionKey,
        params.conversationId,
        params.threadId,
        params.conversationType,
        now,
        now,
      );
    return this.getByMessageId(params.messageId)!;
  }

  updateProgress(messageId: string, fields: Partial<MessageRecord>) {
    const now = new Date().toISOString();
    const assignments: string[] = ["updated_at = ?"];
    const values: Array<string | null> = [now];
    const mapping: Record<string, string> = {
      requestId: "request_id",
      chatroomId: "chatroom_id",
      chatMsgId: "chatmsg_id",
      runId: "run_id",
      status: "status",
      errorCode: "error_code",
      errorMessage: "error_message",
    };
    for (const [key, column] of Object.entries(mapping)) {
      const value = fields[key as keyof MessageRecord];
      if (value === undefined) {
        continue;
      }
      assignments.push(`${column} = ?`);
      values.push(value === null ? null : String(value));
    }
    values.push(messageId);
    this.db
      .prepare(`update inbound_messages set ${assignments.join(", ")} where message_id = ?`)
      .run(...values);
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      create table if not exists inbound_messages (
        message_id text primary key,
        event_id text not null,
        employee_id text not null,
        agent_id text not null,
        session_key text not null,
        conversation_id text not null,
        thread_id text,
        conversation_type text not null,
        request_id text,
        chatroom_id text,
        chatmsg_id text,
        run_id text,
        status text not null,
        error_code text,
        error_message text,
        created_at text not null,
        updated_at text not null
      );
      create index if not exists idx_inbound_messages_status on inbound_messages(status);
      create index if not exists idx_inbound_messages_run_id on inbound_messages(run_id);
    `);
  }

  private mapRow(row: Record<string, unknown>): MessageRecord {
    return {
      messageId: String(row.message_id),
      eventId: String(row.event_id),
      employeeId: String(row.employee_id),
      agentId: String(row.agent_id),
      sessionKey: String(row.session_key),
      conversationId: String(row.conversation_id),
      threadId: row.thread_id ? String(row.thread_id) : null,
      conversationType: String(row.conversation_type),
      requestId: row.request_id ? String(row.request_id) : null,
      chatroomId: row.chatroom_id ? String(row.chatroom_id) : null,
      chatMsgId: row.chatmsg_id ? String(row.chatmsg_id) : null,
      runId: row.run_id ? String(row.run_id) : null,
      status: String(row.status) as MessageRecord["status"],
      errorCode: row.error_code ? String(row.error_code) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
