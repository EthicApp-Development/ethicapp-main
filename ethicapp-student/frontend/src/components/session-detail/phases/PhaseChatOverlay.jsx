import { useEffect, useMemo, useRef, useState } from 'react';
import { legacyUserApi } from '../../../api/studentApi.js';

const DEFAULT_HEIGHT_PX = 320;
const MIN_HEIGHT_PX = 220;

function resolveDisplayName(message, participantsByUserId, isAnonymous, t) {
  const participant = participantsByUserId[Number(message.authorId)] ?? null;

  if (isAnonymous) {
    if (participant?.anon_mask) {
      return participant.anon_mask;
    }

    return t('sessionDetail.chatAnonymousAuthor');
  }

  if (participant) {
    const firstName = typeof participant.firstname === 'string' ? participant.firstname.trim() : '';
    const lastName = typeof participant.lastname === 'string' ? participant.lastname.trim() : '';
    const fullName = `${firstName} ${lastName}`.trim();

    if (fullName.length > 0) {
      return fullName;
    }

    if (typeof participant.name === 'string' && participant.name.trim().length > 0) {
      return participant.name.trim();
    }
  }

  if (typeof message.authorName === 'string' && message.authorName.trim().length > 0) {
    return message.authorName.trim();
  }

  return t('sessionDetail.chatPeerAuthor');
}

function normalizeMessage(message) {
  const id = Number(message?.id ?? message?.msgid ?? message?.mid);
  const authorId = Number(message?.uid ?? message?.user_id ?? message?.author_id);
  const authorName = message?.display_name ?? message?.name ?? message?.username ?? '';
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  const createdAt = message?.date ?? message?.created_at ?? message?.createdAt ?? '';
  const parentId = Number(message?.parent_id ?? message?.parentId);

  return {
    id: Number.isInteger(id) ? id : Math.random(),
    authorId: Number.isInteger(authorId) ? authorId : null,
    authorName: typeof authorName === 'string' ? authorName : '',
    content,
    createdAt: typeof createdAt === 'string' ? createdAt : '',
    parentId: Number.isInteger(parentId) ? parentId : null
  };
}

export default function PhaseChatOverlay({ isOpen, onClose, onHeightChange, phase, chatRefreshToken, userId, t }) {
  const [heightPx, setHeightPx] = useState(DEFAULT_HEIGHT_PX);
  const [messages, setMessages] = useState([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [replyToMessageId, setReplyToMessageId] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (typeof onHeightChange !== 'function') {
      return;
    }

    onHeightChange(isOpen ? heightPx : 0);
  }, [heightPx, isOpen, onHeightChange]);

  const groupId = Number(phase?.group?.id ?? phase?.groupId);
  const participantsByUserId = useMemo(() => {
    const participants = Array.isArray(phase?.groupParticipants) ? phase.groupParticipants : [];

    return participants.reduce((acc, participant) => {
      const participantUserId = Number(participant?.user_id);
      if (!Number.isInteger(participantUserId) || participantUserId <= 0) {
        return acc;
      }

      acc[participantUserId] = participant;
      return acc;
    }, {});
  }, [phase]);

  const isAnonymousPhase = phase?.features?.anonymous === true || phase?.groupAnonymous === true;

  const messagesById = useMemo(() => messages.reduce((acc, message) => {
    acc[message.id] = message;
    return acc;
  }, {}), [messages]);

  const selectedReplyMessage = useMemo(() => (
    Number.isInteger(replyToMessageId) ? messagesById[replyToMessageId] ?? null : null
  ), [replyToMessageId, messagesById]);

  const fallbackQuestionId = useMemo(() => {
    const orderedTasks = Array.isArray(phase?.tasks) ? [...phase.tasks] : [];
    orderedTasks.sort((leftTask, rightTask) => Number(leftTask?.order ?? 0) - Number(rightTask?.order ?? 0));
    return Number(orderedTasks[0]?.id);
  }, [phase]);

  const loadMessages = async () => {
    if (!Number.isInteger(groupId) || groupId <= 0 || !Number.isInteger(fallbackQuestionId) || fallbackQuestionId <= 0) {
      return;
    }

    setLoading(true);

    try {
      const { data } = await legacyUserApi.get(`/groups/${groupId}/question/${fallbackQuestionId}/chat_messages`);
      const chatTranscript = Array.isArray(data?.chat_transcript) ? data.chat_transcript : [];
      setMessages(chatTranscript.map(normalizeMessage).filter((message) => message.content.length > 0));
      setReplyToMessageId((currentReplyToMessageId) => (
        Number.isInteger(currentReplyToMessageId) && chatTranscript.some((message) => Number(message?.id ?? message?.msgid ?? message?.mid) === currentReplyToMessageId)
          ? currentReplyToMessageId
          : null
      ));
      setErrorMessage('');
    } catch {
      setErrorMessage(t('sessionDetail.chatLoadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    loadMessages();
  }, [isOpen, groupId, fallbackQuestionId]);

  useEffect(() => {
    if (!isOpen || !chatRefreshToken) {
      return;
    }

    loadMessages();
  }, [chatRefreshToken]);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }

    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isOpen]);

  const onResizeStart = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = heightPx;

    const onMove = (moveEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const maxHeight = Math.max(window.innerHeight - 80, MIN_HEIGHT_PX);
      const nextHeight = Math.min(Math.max(startHeight + deltaY, MIN_HEIGHT_PX), maxHeight);
      setHeightPx(nextHeight);
    };

    const onEnd = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  };

  const sendMessage = async () => {
    const content = draftMessage.trim();

    if (!content || sending || !Number.isInteger(groupId) || groupId <= 0 || !Number.isInteger(fallbackQuestionId) || fallbackQuestionId <= 0) {
      return;
    }

    setSending(true);
    try {
      await legacyUserApi.post(`/phases/${phase.id}/question/${fallbackQuestionId}/chat_messages`, {
        group_id: groupId,
        content,
        parent_id: Number.isInteger(replyToMessageId) ? replyToMessageId : null
      });
      setDraftMessage('');
      setReplyToMessageId(null);
      await loadMessages();
    } catch {
      setErrorMessage(t('sessionDetail.chatSendError'));
    } finally {
      setSending(false);
    }
  };

  const getMessageDepth = (message) => {
    const visited = new Set();
    let current = message;
    let depth = 0;

    while (Number.isInteger(current?.parentId) && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      const parent = messagesById[current.parentId];
      if (!parent) {
        break;
      }

      depth += 1;
      current = parent;
    }

    return Math.min(depth, 3);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <section className="position-fixed start-0 end-0 bottom-0 bg-white border-top shadow-lg" style={{ height: `${heightPx}px`, zIndex: 1060 }}>
      <button
        type="button"
        className="w-100 border-0 bg-light py-1"
        onMouseDown={onResizeStart}
        aria-label={t('sessionDetail.chatResizeAria')}
      >
        <i className="fa-solid fa-grip-lines text-muted" aria-hidden="true" />
      </button>
      <div className="d-flex justify-content-between align-items-center border-bottom px-3 py-2">
        <h2 className="h6 mb-0">{t('sessionDetail.chatTitle')}</h2>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose}>{t('sessionDetail.chatClose')}</button>
      </div>
      <div className="d-flex flex-column" style={{ height: `calc(${heightPx}px - 78px)` }}>
        <div ref={listRef} className="flex-grow-1 overflow-auto px-3 py-2">
          {loading ? <p className="text-muted small mb-0">{t('sessionDetail.chatLoading')}</p> : null}
          {!loading && messages.length === 0 ? <p className="text-muted small mb-0">{t('sessionDetail.chatEmpty')}</p> : null}
          {messages.map((message) => {
            const depth = getMessageDepth(message);
            const replyTarget = Number.isInteger(message.parentId) ? messagesById[message.parentId] ?? null : null;
            const isOwnMessage = message.authorId === Number(userId);

            return (
              <div key={message.id} className={`mb-2 d-flex flex-column ${isOwnMessage ? 'align-items-end' : 'align-items-start'}`} style={{ marginLeft: `${depth * 12}px` }}>
                <small className="text-muted d-block">{isOwnMessage ? t('sessionDetail.chatYouAuthor') : resolveDisplayName(message, participantsByUserId, isAnonymousPhase, t)}</small>
                {replyTarget ? <div className={`small text-muted mb-1 px-2 ${isOwnMessage ? 'border-end pe-2 text-end' : 'border-start ps-2 text-start'}`}>↪ {replyTarget.content}</div> : null}
                <div
                  className="rounded px-2 py-1 text-dark border shadow-sm"
                  style={{ maxWidth: '85%', backgroundColor: isOwnMessage ? '#deffcf' : '#ffffff' }}
                >
                  {message.content}
                </div>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 mt-1 text-decoration-none"
                  onClick={() => setReplyToMessageId(message.id)}
                >
                  {t('sessionDetail.chatReply')}
                </button>
              </div>
            );
          })}
        </div>
        {errorMessage ? <div className="alert alert-danger rounded-0 py-1 px-2 mb-0">{errorMessage}</div> : null}
        <div className="border-top p-2">
          {selectedReplyMessage ? (
            <div className="small text-muted border-start ps-2 mb-2 d-flex justify-content-between align-items-start gap-2">
              <span>
                {t('sessionDetail.chatReplyingTo')}
                <strong className="ms-1">{selectedReplyMessage.authorId === Number(userId) ? t('sessionDetail.chatYouAuthor') : resolveDisplayName(selectedReplyMessage, participantsByUserId, isAnonymousPhase, t)}</strong>
                : {selectedReplyMessage.content}
              </span>
              <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => setReplyToMessageId(null)}>{t('sessionDetail.chatCancelReply')}</button>
            </div>
          ) : null}
          <div className="d-flex gap-2">
            <input
              className="form-control"
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={t('sessionDetail.chatInputPlaceholder')}
            />
            <button type="button" className="btn btn-danger" onClick={sendMessage} disabled={sending}>{sending ? t('sessionDetail.chatSending') : t('sessionDetail.chatSend')}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
