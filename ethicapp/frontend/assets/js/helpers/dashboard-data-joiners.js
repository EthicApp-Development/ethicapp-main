export const phaseDataJoiners = {
    semantic_differential: sdPhaseDataJoiner,
    ranking: rankingPhaseDataJoiner
};

/*
- en users considerar solamente los usuarios con role 'A'.
- para cada user: 

*/

/*
RESPONSES - all phases
d.stageid,
d.orden,
s.uid,
r.tmid,
s.did,
s.sel,
s.comment,
st.number AS phase_number

USERS
u.id,
u.name,
u.mail,
u.aprendizaje,
u.role,
su.device

CHAT MESSAGE COUNT - for a particular phase
c.did,
u.uid,
u.tmid,
COUNT(*) AS message_count
*/
let sdPhaseDataJoiner = (phaseDescriptor, users, responses, chatMessageStats) => {

};

let rankingPhaseDataJoiner = (phaseDescriptor, users, responses, chatMessageStats) => {

};

export let groupPhaseChatMessageSum = (chatMessageStats) => {

};
