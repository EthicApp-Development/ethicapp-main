let addContentToPhase = (content) => {

}

return $http({url: "add-differential-stage", method: "post", data: p})
    .then(() => {
        if (index === phase.questions.length - 1) {
            let pp = {sesid: sessionId, stageid: stageid};
            return $http({ url: "session-start-stage", method: "post", data: pp })
                .then(() => {
                    Notification.success("Etapa creada correctamente");
                });
        }
    });
