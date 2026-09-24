export const BUILT_IN_LAYOUT = {
    grid: {
        root: {
            type: "branch",
            data: [
                { type: "leaf", data: { views: ["sessions"], activeView: "sessions", id: "1" }, size: 266 },
                {
                    type: "branch",
                    data: [
                        {
                            type: "branch",
                            data: [
                                { type: "leaf", data: { views: ["repl"], activeView: "repl", id: "9" }, size: 1377 },
                                { type: "leaf", data: { views: ["state"], activeView: "state", id: "2" }, size: 1376 },
                            ],
                            size: 579,
                        },
                        {
                            type: "branch",
                            data: [
                                { type: "leaf", data: { views: ["console"], activeView: "console", id: "4" }, size: 2090 },
                                { type: "leaf", data: { views: ["watches"], activeView: "watches", id: "5" }, size: 663 },
                            ],
                            size: 578,
                        },
                    ],
                    size: 2753,
                },
                { type: "leaf", data: { views: ["triggers", "module"], activeView: "triggers", id: "3" }, size: 394 },
            ],
            size: 1157,
        },
        width: 3413,
        height: 1157,
        orientation: "HORIZONTAL",
    },
    panels: {
        sessions: { id: "sessions", contentComponent: "sessions", title: "Sessions" },
        repl: { id: "repl", contentComponent: "repl", title: "REPL" },
        state: { id: "state", contentComponent: "state", title: "State" },
        console: { id: "console", contentComponent: "console", title: "Console & events" },
        watches: { id: "watches", contentComponent: "watches", title: "Watches" },
        triggers: { id: "triggers", contentComponent: "triggers", title: "Triggers" },
        module: { id: "module", contentComponent: "module", title: "Module" },
    },
    activeGroup: "9",
} as const;
