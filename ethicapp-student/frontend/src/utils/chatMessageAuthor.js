// The author name a group chat message carries, as PhaseChatOverlay shows it.
//
// GET /groups/:group_id/question/:question_id/chat_messages names an external
// service's agent in `author_name`: the name the room gives it, such as
// Polyadic's "agente" or the teacher's nickname for the guide (#1026). Other
// messages keep the fields the overlay read before, so students' names still
// come from the group's participants and anonymous masks.
export function chatMessageAuthorName(message, authorRole) {
  const candidates = authorRole === 'external_service'
    ? [message?.author_name, message?.display_name, message?.name]
    : [message?.display_name, message?.name, message?.username];
  const name = candidates.find(value => typeof value === 'string' && value.trim().length > 0);
  return name ? name.trim() : '';
}
