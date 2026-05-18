const DEFAULT_CONTAINER_CLASS = "teacher-toast-container";
const DEFAULT_TIMEOUT_MS = 5000;

function getAlertType(className) {
    if (className && className.includes("alert-danger")) return "danger";
    if (className && className.includes("alert-warning")) return "warning";
    if (className && className.includes("alert-success")) return "success";
    if (className && className.includes("alert-info")) return "info";
    return "success";
}

function normalizeToastOptions(options = {}) {
    const className = options.className || "";
    const type = options.type || getAlertType(className);
    const timeout = Number.isFinite(options.timeout) ? options.timeout : DEFAULT_TIMEOUT_MS;

    return {
        id:             Date.now() + Math.random(),
        containerClass: options.containerClass || DEFAULT_CONTAINER_CLASS,
        dismissible:    Boolean(options.dismissible),
        message:        options.message || "",
        timeout,
        type
    };
}

export function TeacherToastService($rootScope, $timeout) {
    const toasts = new Map();
    const timers = new Map();

    function notify(containerClass) {
        $rootScope.$evalAsync(() => {
            $rootScope.$broadcast("teacherToastChanged", containerClass);
        });
    }

    function clearTimer(containerClass) {
        const timer = timers.get(containerClass);
        if (timer) {
            $timeout.cancel(timer);
            timers.delete(containerClass);
        }
    }

    function dismiss(containerClass, toastId) {
        const currentToast = toasts.get(containerClass);
        if (!currentToast || (toastId && currentToast.id !== toastId)) {
            return;
        }

        clearTimer(containerClass);
        toasts.delete(containerClass);
        notify(containerClass);
    }

    this.create = function(options) {
        const toast = normalizeToastOptions(options);

        clearTimer(toast.containerClass);
        toasts.set(toast.containerClass, toast);
        notify(toast.containerClass);

        if (toast.timeout > 0) {
            const timer = $timeout(() => {
                dismiss(toast.containerClass, toast.id);
            }, toast.timeout);
            timers.set(toast.containerClass, timer);
        }

        return toast;
    };

    this.dismiss = dismiss;

    this.getToast = function(containerClass = DEFAULT_CONTAINER_CLASS) {
        return toasts.get(containerClass) || null;
    };
}
