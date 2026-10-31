// A group's answers and chat in a semantic-differential phase, in the
// response detail panel of the teacher's activity dashboard (#896, epic
// #892). It replaces the group response modal and keeps its template and its
// controller's work: it loads the group's answers and chat messages,
// subscribes to the group's live chat while it lives ($onInit / $onDestroy),
// sends the teacher's messages and replies, and names the authors, the
// teacher as "Teacher". The chat itself is `teacher-group-chat`, unchanged.
//
// With `use-tabs`, the answers and the chat are tabs: it opens on the answers
// (or on the chat when `initial-tab` says so), the Chat tab counts the
// messages that arrived since it was last shown, and a one-line digest of the
// group's values sits above the transcript. Without it, the answers sit above
// the chat, with a splitter the teacher can drag or move with the arrow keys.
//
// The group's answers are read again whenever its members' rows in the live
// table change, so the panel follows the table.
//
// With `hide-names` (#897), the members' rows carry their pseudonyms, which
// name the answers and the chat's students; the names the server sends with
// the answers and the messages are not used, the members are listed by
// letter, and the teacher and the AI agents keep their labels.

import {
    hiddenChatAuthorName,
    participantId,
    pseudonymLabel,
} from "../helpers/hidden-names.js";
import {
    SPLIT_KEYBOARD_STEP,
    clampSplitHeight,
    detailQuestions,
    groupAnswerSignature,
    groupMemberRows,
    groupValueDigest,
    mergeChatMessages,
    scaleOptions,
    unreadMessageCount,
} from "../helpers/response-detail.js";

// Numbers each instance, for the ids that tie its tabs to their panels.
let instanceCount = 0;

function SdGroupResponseDetailController($scope, $translate, $window, $element,
    ActivityStateService, TeacherGroupChatService) {
    const $ctrl = this;

    $ctrl.uid = ++instanceCount;
    $ctrl.questions = [];
    $ctrl.members = [];
    $ctrl.digest = [];
    $ctrl.responses = [];
    $ctrl.responsesLoading = false;
    $ctrl.chatMessages = [];
    $ctrl.chatLoading = false;
    $ctrl.chatSending = false;
    $ctrl.chatError = "";
    $ctrl.activeTab = "answers";
    // The answers' height in px once the teacher moves the splitter; until
    // then the two parts share the panel.
    $ctrl.answersHeight = null;
    $ctrl.splitRatio = 50;

    // The messages the chat has shown; the Chat tab counts the others.
    const seenMessageIds = new Set();
    let answerSignature = null;
    let memberNamesSignature = null;
    let participantNames = {};
    let responsesRequest = 0;
    let unsubscribeFromGroupChat = null;
    let stopSplitDrag = null;
    let destroyed = false;

    // Applies a change from a promise or a socket in the next digest, unless
    // the panel moved on to another row or closed in the meantime.
    function applyAsync(change) {
        $scope.$applyAsync(() => {
            if (!destroyed) {
                change();
            }
        });
    }

    function translated(key, fallback) {
        const text = typeof $translate?.instant === "function" ? $translate.instant(key) : key;
        return text && text !== key ? text : fallback;
    }

    function groupSelection() {
        return { groupId: $ctrl.group?.groupId, groupNumber: $ctrl.group?.groupNumber };
    }

    function firstQuestionId() {
        return Number($ctrl.questions[0]?.id);
    }

    function hidesNames() {
        return $ctrl.hideNames === true;
    }

    function rebuildParticipantNames() {
        participantNames = {};
        // The answers carry the students' real names: not while they are
        // hidden.
        if (!hidesNames()) {
            $ctrl.responses.forEach(response => {
                if (response?.userId && response.userName) {
                    participantNames[response.userId] = response.userName;
                }
            });
        }
        $ctrl.members.forEach(member => {
            if (member?.userId && member.userName) {
                participantNames[member.userId] = member.userName;
            }
        });
    }

    // What the members are called, and whether names are hidden: it changes
    // when the teacher turns the switch, without any answer changing.
    function namesSignature(members) {
        return `${hidesNames()}|${members.map(member => member?.userName ?? "").join("\n")}`;
    }

    // Reads the group's members from the live table. True when an answer
    // changed since the last read, not on the first one.
    function refreshMembers() {
        const members = groupMemberRows($ctrl.phaseData, groupSelection());
        const signature = groupAnswerSignature(members, $ctrl.questions);
        const names = namesSignature(members);
        if (signature === answerSignature) {
            if (names !== memberNamesSignature) {
                memberNamesSignature = names;
                $ctrl.members = members;
                $ctrl.digest = groupValueDigest(members, $ctrl.questions);
                rebuildParticipantNames();
            }
            return false;
        }

        const firstRead = answerSignature === null;
        answerSignature = signature;
        memberNamesSignature = names;
        $ctrl.members = members;
        $ctrl.digest = groupValueDigest(members, $ctrl.questions);
        rebuildParticipantNames();
        return !firstRead;
    }

    function markMessagesSeen() {
        $ctrl.chatMessages.forEach(message => seenMessageIds.add(message.id));
    }

    $ctrl.$onChanges = function(changes) {
        if (changes.phaseData) {
            $ctrl.questions = detailQuestions($ctrl.phaseData);
        }
    };

    $ctrl.$onInit = function() {
        $ctrl.activeTab = $ctrl.initialTab === "chat" ? "chat" : "answers";
        refreshMembers();
        $ctrl.loadResponses();
        $ctrl.loadChatMessages();

        if ($ctrl.canUseLiveChat && $ctrl.group?.groupId) {
            unsubscribeFromGroupChat = TeacherGroupChatService.subscribeToGroup(
                $ctrl.group.groupId,
                message => applyAsync(() => {
                    $ctrl.chatMessages = mergeChatMessages($ctrl.chatMessages, [message]);
                })
            );
        }
    };

    $ctrl.$doCheck = function() {
        if (refreshMembers()) {
            $ctrl.loadResponses();
        }
        if ($ctrl.isChatVisible()) {
            markMessagesSeen();
        }
    };

    $ctrl.$onDestroy = function() {
        destroyed = true;
        if (typeof unsubscribeFromGroupChat === "function") {
            unsubscribeFromGroupChat();
            unsubscribeFromGroupChat = null;
        }
        if (stopSplitDrag) {
            stopSplitDrag();
        }
    };

    $ctrl.loadResponses = async function() {
        const groupId = $ctrl.group?.groupId;
        const phaseId = $ctrl.phaseData?.descriptor?.id;
        if (!groupId || !phaseId) {
            return;
        }

        const request = ++responsesRequest;
        $ctrl.responsesLoading = $ctrl.responses.length === 0;
        let responses = [];
        try {
            responses = await ActivityStateService.getGroupResponses(groupId, phaseId);
        } catch (error) {
            console.error("Error loading the group's responses:", error);
        }
        applyAsync(() => {
            // Only the latest read counts.
            if (request === responsesRequest) {
                $ctrl.responses = Array.isArray(responses) ? responses : [];
                $ctrl.responsesLoading = false;
                rebuildParticipantNames();
            }
        });
    };

    $ctrl.loadChatMessages = async function() {
        const questionId = firstQuestionId();
        const groupId = $ctrl.group?.groupId;
        if (!questionId || !groupId) {
            return;
        }

        $ctrl.chatLoading = true;
        $ctrl.chatError = "";
        try {
            const messages = await TeacherGroupChatService.loadMessages(groupId, questionId);
            applyAsync(() => {
                // Keep what arrived live while the transcript loaded.
                $ctrl.chatMessages = mergeChatMessages(messages, $ctrl.chatMessages);
                $ctrl.chatLoading = false;
                // The transcript the panel opens with counts as seen; the
                // Chat tab counts what arrives after it.
                markMessagesSeen();
            });
        } catch (error) {
            console.error("Error loading group chat messages:", error);
            applyAsync(() => {
                $ctrl.chatLoading = false;
                $ctrl.chatError = translated("response_detail_chat_load_error",
                    "Unable to load chat messages.");
            });
        }
    };

    $ctrl.sendChatMessage = async function(content, parentId = null) {
        const questionId = firstQuestionId();
        const groupId = $ctrl.group?.groupId;

        if (!content || !$ctrl.canUseLiveChat || $ctrl.chatSending || !questionId || !groupId) {
            return;
        }

        $ctrl.chatSending = true;
        $ctrl.chatError = "";
        try {
            const sentMessage = await TeacherGroupChatService.sendMessage({
                phaseId: $ctrl.phaseData.descriptor.id,
                questionId,
                groupId,
                content,
                parentId,
            });

            applyAsync(() => {
                if (sentMessage?.content) {
                    $ctrl.chatMessages = mergeChatMessages($ctrl.chatMessages, [sentMessage]);
                }
                $ctrl.chatSending = false;
            });
        } catch (error) {
            console.error("Error sending teacher group chat message:", error);
            applyAsync(() => {
                $ctrl.chatSending = false;
                $ctrl.chatError = translated("response_detail_chat_send_error",
                    "Unable to send chat message.");
            });
            throw error;
        }
    };

    $ctrl.buildScaleOptions = function(question) {
        return scaleOptions(question);
    };

    $ctrl.getQuestionResponses = function(question) {
        const questionId = Number(question?.id);
        const questionNumber = Number(question?.number);

        const responses = $ctrl.responses.filter(response => {
            const sameQuestionId = questionId && Number(response.questionId) === questionId;
            const sameQuestionOrder = questionNumber
                && Number(response.questionOrder) === questionNumber;
            return sameQuestionId || sameQuestionOrder;
        });
        if (!hidesNames()) {
            return responses;
        }

        // In the members' order, by letter, never by name.
        const order = new Map($ctrl.members.map((member, index) => [participantId(member), index]));
        const place = response => order.get(participantId(response)) ?? order.size;
        return responses.sort((left, right) => place(left) - place(right));
    };

    function translateInstant(key, params) {
        return typeof $translate?.instant === "function" ? $translate.instant(key, params) : key;
    }

    $ctrl.getUserName = function(userId) {
        if (hidesNames()) {
            return participantNames[userId] || pseudonymLabel(null, translateInstant);
        }
        return participantNames[userId] || `User ${userId}`;
    };

    $ctrl.isTeacherMessage = function(message) {
        return message?.authorRole === "P";
    };

    $ctrl.getChatAuthorName = function(message) {
        const teacherLabel = translated("teacher_chat_author_label", "Teacher");
        if (hidesNames()) {
            return hiddenChatAuthorName(message, {
                memberLabels: participantNames,
                teacherLabel,
                translate:    translateInstant,
            });
        }
        if ($ctrl.isTeacherMessage(message)) {
            return teacherLabel;
        }
        return participantNames[message?.uid] || message?.authorName
            || $ctrl.getUserName(message?.uid);
    };

    // Tabs, when the panel is not tall enough for both parts.

    $ctrl.isTabSelected = function(tab) {
        return $ctrl.activeTab === tab;
    };

    $ctrl.selectTab = function(tab) {
        $ctrl.activeTab = tab === "chat" ? "chat" : "answers";
        if ($ctrl.isChatVisible()) {
            markMessagesSeen();
        }
    };

    $ctrl.isChatVisible = function() {
        return !$ctrl.useTabs || $ctrl.activeTab === "chat";
    };

    $ctrl.unreadCount = function() {
        return $ctrl.isChatVisible()
            ? 0
            : unreadMessageCount($ctrl.chatMessages, seenMessageIds, $ctrl.isTeacherMessage);
    };

    // The splitter between the answers and the chat.

    function splitElements() {
        const root = $element?.[0];
        return {
            group:    root?.querySelector?.(".response-detail-group") || null,
            answers:  root?.querySelector?.(".response-detail-answers") || null,
            splitter: root?.querySelector?.(".response-detail-splitter") || null,
        };
    }

    function availableSplitHeight() {
        const { group, splitter } = splitElements();
        return (group?.clientHeight || 0) - (splitter?.offsetHeight || 0);
    }

    function currentAnswersHeight() {
        return $ctrl.answersHeight ?? splitElements().answers?.offsetHeight ?? 0;
    }

    function moveSplitter(height, available) {
        const clamped = clampSplitHeight(height, available);
        if (clamped === null) {
            return;
        }
        $ctrl.answersHeight = clamped;
        $ctrl.splitRatio = Math.round(100 * clamped / available);
    }

    $ctrl.answersStyle = function() {
        return !$ctrl.useTabs && $ctrl.answersHeight !== null
            ? { flex: `0 1 ${$ctrl.answersHeight}px` }
            : {};
    };

    $ctrl.startSplitDrag = function(event) {
        if (!event || event.button !== 0 || typeof $window?.addEventListener !== "function") {
            return;
        }
        event.preventDefault();
        if (stopSplitDrag) {
            stopSplitDrag();
        }

        const startY = event.clientY;
        const startHeight = currentAnswersHeight();
        const available = availableSplitHeight();
        const onMove = moveEvent => {
            applyAsync(() => moveSplitter(startHeight + moveEvent.clientY - startY, available));
        };
        const onUp = () => stopSplitDrag?.();

        $window.addEventListener("mousemove", onMove);
        $window.addEventListener("mouseup", onUp);
        stopSplitDrag = () => {
            $window.removeEventListener("mousemove", onMove);
            $window.removeEventListener("mouseup", onUp);
            stopSplitDrag = null;
        };
    };

    $ctrl.onSplitterKeydown = function(event) {
        const step = { ArrowUp: -SPLIT_KEYBOARD_STEP, ArrowDown: SPLIT_KEYBOARD_STEP }[event?.key];
        if (!step) {
            return;
        }
        event.preventDefault();
        moveSplitter(currentAnswersHeight() + step, availableSplitHeight());
    };
}

export default {
    bindings: {
        // The group's summary row of the live table.
        group:          "<",
        // The phase, its questions merged with the design's.
        phaseData:      "<",
        // Whether the teacher can write: only in the current phase of an
        // activity that is not finished. Otherwise the chat is read-only.
        canUseLiveChat: "<",
        // Whether the dashboard hides the students' names (#897).
        hideNames:      "<",
        // The activity case's videos (#785), for the videos in questions.
        caseVideos:     "<",
        // Tabs instead of a split, when the panel is not tall enough.
        useTabs:        "<",
        // The tab to open on: "answers" (the default) or "chat".
        initialTab:     "<",
    },
    controller: ["$scope", "$translate", "$window", "$element", "ActivityStateService",
        "TeacherGroupChatService", SdGroupResponseDetailController],
    templateUrl: "/assets/static/views/teacher/fragments/sd-group-response-detail.template.html",
};
