import Enumerable from 'linq';

export const phaseDataJoiners = {
    semantic_differential: sdPhaseDataJoiner,
    ranking: rankingPhaseDataJoiner
};

let sdPhaseDataJoiner = (phaseDescriptor, responses, users, 
    chatMessageStats, phaseId, existingData = null) => {
    // Find the phase descriptor matching the given phaseId
    const phase = Enumerable.from(phaseDescriptor)
        .firstOrDefault(p => p.id === phaseId);

    if (!phase) return [];

    // Find the corresponding phase in the new responses format
    const phaseNumber = phase.number;
    const phaseResponses = Enumerable.from(responses.phases)
        .firstOrDefault(p => p.phase_number === phaseNumber)?.responses || [];

    // If no existingData is provided, build the structure from scratch
    if (!existingData) {
        const relevantUsers = Enumerable.from(users)
            .where(u => u.role === 'A') // Filter users with role 'A'
            .toArray();

        const relevantChats = Enumerable.from(chatMessageStats)
            .where(chat => phaseResponses.some(r => r.did === chat.did)) // Match relevant chats to responses
            .toArray();

        // Create a map of users indexed by their uid
        const usersMap = relevantUsers.reduce((acc, user) => {
            acc[user.id] = {
                userId: user.id,
                userName: user.name
            };
            return acc;
        }, {});

        // Consolidate responses and chat statistics for each user
        phase.questions.forEach(question => {
            const questionNumber = question.number;

            // Ensure default chat count (chatRN) for all users
            Object.values(usersMap).forEach(user => {
                user[`chatR${questionNumber}`] = 0; // Default value for chat count
            });

            // Assign responses (e.g., r1, r2) to the corresponding user
            phaseResponses
                .filter(response => response.did === question.id)
                .forEach(response => {
                    const user = usersMap[response.uid];
                    if (user) {
                        user[`r${questionNumber}`] = response.sel; // Set response value
                    }
                });

            // Assign chat statistics (e.g., chatR1, chatR2) to the corresponding user
            relevantChats
                .filter(chat => chat.did === question.id)
                .forEach(chat => {
                    const user = usersMap[chat.uid];
                    if (user) {
                        user[`chatR${questionNumber}`] = chat.messageCount; // Update chat count
                    }
                });
        });

        return Object.values(usersMap);
    }

    // If existingData is provided, update it with the new responses
    const existingDataMap = Enumerable.from(existingData)
        .toDictionary(user => user.userId); // Create a dictionary for quick access by userId

    // Update only the relevant properties based on new responses
    phaseResponses.forEach(response => {
        const user = existingDataMap.get(response.uid);
        if (user) {
            // Update the specific response property
            const question = phase.questions.find(q => q.id === response.did);
            if (question) {
                const questionNumber = question.number;
                user[`r${questionNumber}`] = response.sel; // Update response value
            }
        }
    });

    return existingData;
};

export let rankingPhaseDataJoiner = (phaseDescriptor, responses, users, 
    chatMessageStats, phaseId, existingData = null) => {
    // Find the phase descriptor matching the given phaseId
    const phase = Enumerable.from(phaseDescriptor)
        .firstOrDefault(p => p.id === phaseId);

    if (!phase) return [];

    // Find the corresponding phase in the new responses format
    const phaseNumber = phase.number;
    const phaseResponses = Enumerable.from(responses.phases)
        .firstOrDefault(p => p.phase_number === phaseNumber)?.responses || [];

    // If no existingData is provided, build the structure from scratch
    if (!existingData) {
        const relevantUsers = Enumerable.from(users)
            .where(u => u.role === 'A') // Filter users with role 'A'
            .toArray();

        const relevantChats = Enumerable.from(chatMessageStats)
            .toArray();

        // Create a map of users indexed by their uid
        const usersMap = relevantUsers.reduce((acc, user) => {
            acc[user.id] = {
                uid: user.id,
                userName: user.name,
                chatCount: 0 // Default chat count
            };
            return acc;
        }, {});

        // Consolidate rankings and chat statistics for each user
        phaseResponses.forEach(response => {
            const user = usersMap[response.uid];
            if (user) {
                // Assign the ranked item description and actor ID to the respective order
                user[`r${response.orden}`] = response.description;
                user[`idR${response.orden}`] = response.actorid;
            }
        });

        // Sum up chat counts for each user
        relevantChats.forEach(chat => {
            const user = usersMap[chat.uid];
            if (user) {
                user.chatCount += chat.messageCount || 0;
            }
        });

        return Object.values(usersMap);
    }

    // If existingData is provided, update it with the new responses
    const existingDataMap = Enumerable.from(existingData)
        .toDictionary(user => user.uid); // Create a dictionary for quick access by uid

    // Update only the relevant properties based on new responses
    phaseResponses.forEach(response => {
        const user = existingDataMap.get(response.uid);
        if (user) {
            // Update the ranked item description and actor ID for the respective order
            user[`r${response.orden}`] = response.description;
            user[`idR${response.orden}`] = response.actorid;
        }
    });

    // Update chat counts
    relevantChats.forEach(chat => {
        const user = existingDataMap.get(chat.uid);
        if (user) {
            user.chatCount += chat.messageCount || 0;
        }
    });

    return existingData;
};

export let assignResponseClusters = (rankingData) => {
    // Step 1: Generate concatenated sequences of idR values for each user
    rankingData.forEach(user => {
        user.rankSequence = Object.keys(user)
            .filter(key => key.startsWith('idR')) // Only include keys for idR fields
            .sort() // Ensure the order is consistent
            .map(key => user[key]) // Map to the idR values
            .join('-'); // Concatenate with a separator (e.g., '-')
    });

    // Step 2: Sort users by their rankSequence
    rankingData.sort((a, b) => a.rankSequence.localeCompare(b.rankSequence));

    // Step 3: Assign responseCluster numbers
    let currentCluster = 1;
    rankingData.forEach((user, index) => {
        if (index > 0 && user.rankSequence !== rankingData[index - 1].rankSequence) {
            currentCluster++; // Increment cluster for a new unique sequence
        }
        user.responseCluster = currentCluster; // Assign the cluster number
    });

    // Step 4: Remove temporary rankSequence field
    rankingData.forEach(user => delete user.rankSequence);

    return rankingData;
};

export function addParticipantGroupInfo(phaseData, groups) {
    // Step 1: Create a map of participant ID to group details
    const participantGroupMap = groups.reduce((map, group) => {
        group.participants.forEach(participantId => {
            map[participantId] = { groupId: group.id, groupNumber: group.number };
        });
        return map;
    }, {});

    // Step 2: Add group info to each user object
    const updatedUsers = phaseData.map(user => {
        const groupInfo = participantGroupMap[user.uid] || { groupId: null, groupNumber: null };
        return {
            ...user,
            groupId: groupInfo.groupId,
            groupNumber: groupInfo.groupNumber
        };
    });

    // Step 3: Sort users by group (groupNumber) and then by name (userName)
    return updatedUsers.sort((a, b) => {
        // Sort by groupNumber (null groups go last)
        if (a.groupNumber === null && b.groupNumber !== null) return 1;
        if (b.groupNumber === null && a.groupNumber !== null) return -1;
        if (a.groupNumber !== b.groupNumber) return a.groupNumber - b.groupNumber;

        // If groupNumber is the same, sort alphabetically by userName
        return a.userName.localeCompare(b.userName);
    });
}

export let addGroupStatistics = function(data, translate) {
    // Step 1: Group users by `groupId`
    const groupedData = Enumerable.from(data)
        .groupBy(
            user => user.groupId, // Group by groupId
            user => user,         // Keep the user object
            (groupId, users) => ({ groupId, users: users.toArray() }) // Transform to a useful structure
        )
        .toArray();

    // Step 2: Process each group to calculate statistics and append a summary object
    const processedData = groupedData.flatMap(group => {
        const { groupId, users } = group;

        if (groupId === null) {
            // Handle users without a group (no statistics to compute)
            return users;
        }

        // Extract group details (assumes all users in the group have the same groupNumber)
        const groupNumber = users[0].groupNumber;
        const groupName = `{translate('group_label')} ${groupNumber}`;

        // Calculate chat statistics for the group
        const chatStats = users.reduce((stats, user) => {
            Object.keys(user).forEach(key => {
                if (key.startsWith("chatR")) {
                    stats[key] = (stats[key] || 0) + (user[key] || 0);
                }
            });
            return stats;
        }, {});

        // Create the group summary object
        const groupSummary = {
            groupStatistics: true,
            groupName,
            ...chatStats
        };

        // Return the group users followed by the summary
        return [...users, groupSummary];
    });

    // Step 3: Return the processed data
    return processedData;
};
