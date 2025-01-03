import Enumerable from 'linq';

export const DashboardDataJoiners = {
    semantic_differential: {
        joinPhaseData: (phaseDescriptor, responses, users, chatMessageCount, phaseState = null) => {
            return sdPhaseDataJoiner(phaseDescriptor, responses, users, chatMessageCount, phaseState)
        },
        addGroupInfo: (phaseState, groups) => {
            return addParticipantGroupInfo(phaseState, groups);
        },
        updateGroupStatistics: (phaseState, translator) => {
            return updateGroupStatistics(phaseState, translator);
        },
    },
    ranking: {
        joinPhaseData: (phaseDescriptor, responses, users, chatMessageCount, phaseState) => {
            return rankingPhaseDataJoiner(phaseDescriptor, responses, users, chatMessageCount, phaseState);
        },
        addGroupInfo: (phaseState, groups) => {
            return addParticipantGroupInfo(phaseState, groups);
        },
        updateGroupStatistics: (phaseState, translator) => {
            return updateGroupStatistics(phaseState, translator);
        },
        assignRankingClusters: (phaseState) => {
            return assignRankingClusters(phaseState);
        },
    },
};

let sdPhaseDataJoiner = (phaseDescriptor, responses, users, 
    chatMessageStats, existingData = null) => {

    // Extract phase details
    const phaseNumber = phaseDescriptor.number;
    const questions = phaseDescriptor.questions;

    // Filter relevant users (only those with role 'A')
    const relevantUsers = users.filter(u => u.role === 'A');

    // Match relevant chat statistics
    const relevantChats = chatMessageStats ?? [];

    // Initialize a map of users indexed by their user ID
    const usersMap = relevantUsers.reduce((acc, user) => {
        acc[user.id] = {
            userId: user.id,
            userName: user.name
        };
        return acc;
    }, {});

    // Ensure all questions have default values for all users
    questions.forEach(question => {
        const questionNumber = question.number;

        // Initialize default values for responses and chat counts
        Object.values(usersMap).forEach(user => {
            user[`r${questionNumber}`] = null; // Default value for responses
            user[`chatR${questionNumber}`] = null; // Default value for chat counts
        });

        // Assign response values (e.g., r1, r2) to corresponding users
        responses
            .filter(response => response.did === question.id)
            .forEach(response => {
                const user = usersMap[response.uid];
                if (user) {
                    user[`r${questionNumber}`] = response.sel; // Assign response value
                    user[`commentR${questionNumber}`] = response.comment; // Assign comment value
                }
            });

        // Assign chat statistics (e.g., chatR1, chatR2) to corresponding users
        relevantChats
            .filter(chat => chat.did === question.id)
            .forEach(chat => {
                const user = usersMap[chat.uid];
                if (user) {
                    user[`chatR${questionNumber}`] = chat.messageCount; // Assign chat count
                }
            });
    });

    // If no existingData is provided, return the newly created data structure
    if (!existingData) {
        return Object.values(usersMap);
    }

    // If existingData is provided, update it with the new responses and chats
    const existingDataMap = existingData.reduce((acc, user) => {
        acc[user.userId] = user;
        return acc;
    }, {});

    // Merge existing data with new data
    Object.values(usersMap).forEach(user => {
        if (!existingDataMap[user.userId]) {
            existingDataMap[user.userId] = user; // Add new users
        } else {
            // Update existing users
            Object.assign(existingDataMap[user.userId], user);
        }
    });

    // Convert the updated map back to an array
    return Object.values(existingDataMap);
};

let rankingPhaseDataJoiner = (phaseDescriptor, responses, users, 
    chatMessageStats, existingData = null) => {

    // Extract phase details from phaseDescriptor
    const phaseNumber = phaseDescriptor.number;
    const questions = phaseDescriptor.questions;

    // Filter relevant users (only those with role 'A')
    const relevantUsers = users.filter(u => u.role === 'A');

    // Extract relevant chat statistics
    const relevantChats = chatMessageStats;

    // Initialize a map of users indexed by their user ID
    const usersMap = relevantUsers.reduce((acc, user) => {
        acc[user.id] = {
            uid: user.id,
            userName: user.name,
            chatCount: 0 // Default chat count
        };
        return acc;
    }, {});

    // If no existingData is provided, build the structure from scratch
    if (!existingData) {
        // Assign responses and chat statistics for each user
        responses.forEach(response => {
            const user = usersMap[response.uid];
            if (user) {
                // Assign the ranked item description and actor ID to the respective order
                user[`r${response.orden}`] = response.description || null;
                user[`idR${response.orden}`] = response.actorid || null;
            }
        });

        // Sum up chat counts for each user
        relevantChats.forEach(chat => {
            const user = usersMap[chat.uid];
            if (user) {
                user.chatCount += chat.messageCount || 0;
            }
        });

        // Ensure all users have default values for ranking slots
        questions.forEach((_, index) => {
            const rankNumber = index + 1;
            Object.values(usersMap).forEach(user => {
                user[`r${rankNumber}`] = user[`r${rankNumber}`] || null;
                user[`idR${rankNumber}`] = user[`idR${rankNumber}`] || null;
            });
        });

        return Object.values(usersMap);
    }

    // If existingData is provided, update it with the new responses
    const existingDataMap = existingData.reduce((acc, user) => {
        acc[user.uid] = user;
        return acc;
    }, {});

    // Merge existing data with new responses
    Object.values(usersMap).forEach(user => {
        if (!existingDataMap[user.uid]) {
            existingDataMap[user.uid] = user; // Add new users
        } else {
            const existingUser = existingDataMap[user.uid];
            // Update ranked items and actor IDs
            phaseResponses
                .filter(response => response.uid === user.uid)
                .forEach(response => {
                    existingUser[`r${response.orden}`] = response.description || null;
                    existingUser[`idR${response.orden}`] = response.actorid || null;
                });

            // Update chat counts
            relevantChats
                .filter(chat => chat.uid === user.uid)
                .forEach(chat => {
                    existingUser.chatCount += chat.messageCount || 0;
                });
        }
    });

    // Ensure all users in existingData have default values for ranking slots
    questions.forEach((_, index) => {
        const rankNumber = index + 1;
        Object.values(existingDataMap).forEach(user => {
            user[`r${rankNumber}`] = user[`r${rankNumber}`] || null;
            user[`idR${rankNumber}`] = user[`idR${rankNumber}`] || null;
        });
    });

    return Object.values(existingDataMap); // Convert the updated map back to an array
};

let assignRankingClusters = (rankingData) => {
    // Step 1: Regenerate concatenated sequences of idR values for each user
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

    // Step 4: Sort by responseCluster and then by userName
    rankingData.sort((a, b) => {
        if (a.responseCluster !== b.responseCluster) {
            return a.responseCluster - b.responseCluster; // Sort by cluster
        }
        return a.userName.localeCompare(b.userName); // Sort by name within the cluster
    });

    // Step 5: Remove temporary rankSequence field
    rankingData.forEach(user => delete user.rankSequence);

    return rankingData;
};

function addParticipantGroupInfo(phaseData, groups) {
    // Step 1: Create a map of participant ID to group details
    const participantGroupMap = groups.reduce((map, group) => {
        group.participants.forEach(participantId => {
            map[participantId] = { groupId: group.id, groupNumber: group.number };
        });
        return map;
    }, {});

    // Step 2: Add group info to each user object
    const updatedUsers = phaseData.map(user => {
        const groupInfo = participantGroupMap[user.userId] || { groupId: null, groupNumber: null };
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

let updateGroupStatistics = function(data, translator) {
    // Step 0: Filter out existing group summary objects
    const filteredData = data.filter(user => !user.groupStatistics);

    // Step 1: Group users by `groupId`
    const groupedData = Enumerable.from(filteredData)
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
        const groupLabel = translator('group_label');
        const groupName = `${groupLabel} ${groupNumber}`;

        // Calculate chat statistics for the group
        const chatStats = users.reduce((stats, user) => {
            Object.keys(user).forEach(key => {
                if (key.startsWith("chatR")) {
                    stats[key] = (stats[key] || 0) + (user[key] || 0);
                }
            });
            return stats;
        }, {});

        // Calculate totalChatCount as the sum of all chatR values
        const totalChatCount = Object.values(chatStats).reduce((sum, value) => sum + value, 0);

        // Create the group summary object
        const groupSummary = {
            groupStatistics: true,
            groupName,
            groupNumber,
            ...chatStats,
            totalChatCount
        };

        // Return the group users followed by the summary
        return [...users, groupSummary];
    });

    // Step 3: Return the processed data
    return processedData;
};
