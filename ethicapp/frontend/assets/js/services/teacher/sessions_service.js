export let SessionsService = ($rootScope, $http) => {
    var service = { 
    };
    service.sessions = [];
    service.currentSession = {
        id:      null,
        code:    null,
        users:   [],
        usermap: {}
    };

    service.resetCurrentSession = () => {
        service.currentSession = {
            id:      null,
            code:    null,
            users:   [],
            usermap: {}
        };

        $rootScope.$broadcast("SessionsService_currentSessionUpdated", 
            service.currentSession);
    };

    service.createSessionCode = (sessionId) => {
        const postdata = {
            id: sessionId
        };
    
        let ses = service.sessions.filter(session => session.id == sessionId)[0] || null;
    
        const loadAndFilterSessions = () => {
            return service.loadSessions()
                .then(() => {
                    ses = service.sessions.filter(session => session.id == sessionId)[0] || null;
    
                    if (!ses) {
                        throw new Error(`Cannot create session code for inexisting session with id: ${sessionId}.`);
                    }
                });
        };
    
        const promiseToExecute = ses ? Promise.resolve() : loadAndFilterSessions();
    
        return promiseToExecute
            .then(() => $http.post("generate-session-code", postdata))
            .then(data => {
                if (data.code != null) {
                    ses.code = data.code;
                } else {
                    throw new Error("got null code.");
                }
            })
            .catch(error => {
                console.log(
                    `[Sessions Service] could not generate code for session id:'${sessionId}' error:'${error}`
                );
                throw error;  // This will propagate the error to any caller that's also using `.then()` or `.catch()`
            });
    };
    
    service.setCurrentSession = (id) => {
        return service.lookUpSession(id, true)
            .then(result => {
                if (!result) {
                    throw new Error(`[Sessions Service] session with id:'${id}' not found.`);
                }
                service.currentSession = result;

                $rootScope.$broadcast("SessionsService_currentSessionUpdated", 
                    service.currentSession);                
            })
            .then(() => {
                let postdata = { sesid: service.currentSession.id };
                return $http({ url: "get-ses-users", method: "post", data: postdata })
                    .then((data) => {
                        service.users = data;
                        service.usersmap = {};
                        service.users.forEach((u) => {
                            self.usersmap[u.id] = u;
                        });
                        return service.currentSession;
                    });
            })
            .catch(error => {
                console.log(`[Sessions Service] error: ${error}`);
                throw error;
            }); 
    };

    service.loadSessions = () => {
        return $http({ url: "get-session-list", method: "post" })
            .then(response => {
                service.sessions = response.data;
            })
            .catch(error => {
                console.error(`[Sessions Service] error loading sessions: '${error}'.`);
                throw error;
            });
    };

    service.lookUpSession = (id, reload = true) => {
        const lookup = () => {
            const session = service.sessions.filter(session => session.id == id)[0] ?? null;
            if (!session) {
                console.error(`[Sessions Service] session with id:'${id}' not found.`);
            }
            return session;
        };
    
        if (reload) {
            return service.loadSessions()
                .then(lookup)
                .catch(error => {
                    console.error(
                        `[Sessions Service] error loading sessions for lookup with id:'${id}': '${error}'.`);
                    throw error;
                });
        } else {
            return Promise.resolve(lookup());
        }
    };

    service.archiveSession = function(sessionId){
        var postdata = { sesid: sessionId, val: true };
        return $http({ url: "archive-session", method: "post", data: postdata })
            .catch((error) => {
                console.log(`[Sessions Service] Failed to archive session id:'${sessionId}'`);
                throw error;
            });
    };

    service.restoreSession = function(sessionId){
        var postdata = { sesid: sessionId, val: false };
        return $http({ url: "archive-session", method: "post", data: postdata })
            .catch((error) => {
                console.log(`[Sessions Service] Failed to restore session id:'${sessionId}'`);
                throw error;
            });
    };        
    
    return service;
};