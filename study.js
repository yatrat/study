(function() {
    'use strict';
    const SUBJECT_THEME_COLORS = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#475569'];

    let plannerState = {
        subjects: [
            { id: "sub-1", name: "Mathematics", color: "#3b82f6" },
            { id: "sub-2", name: "Accountancy", color: "#ef4444" },
            { id: "sub-3", name: "Biology", color: "#f59e0b" }
        ],
        timetable: {
            Monday: [
                { id: "slot-1", subjectId: "sub-1", time: "09:00 AM - 10:00 AM", note: "Room 101 - Algebra" }
            ],
            Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: []
        },
        studyLogs: {},
        detailedLogs: [
            { id: "log-1", type: "focus", subjectId: "sub-1", minutes: 25, timestamp: Date.now() - 518400000 },
            { id: "log-2", type: "focus", subjectId: "sub-2", minutes: 50, timestamp: Date.now() - 345600000 },
            { id: "log-3", type: "break", minutes: 15, timestamp: Date.now() - 172800000 }
        ]
    };

    let currentDaySelection = "Monday";
    let activeColorHex = SUBJECT_THEME_COLORS[0];
    
    let timerInterval = null;
    let timerEndTimeStamp = null; 
    let totalSecondsRemaining = 1500; 
    let initialTimerBlockSeconds = 1500;
    let currentSessionMinutes = 25; 
    let activeTimerMode = "focus";
    let isTimerRunning = false;
    let wakeLockInstance = null;
    
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    }

    const storedPlannerBytes = localStorage.getItem('studytimer_planner_db_bytes');
    if (storedPlannerBytes) {
        try {
            plannerState = JSON.parse(storedPlannerBytes);
        } catch (err) {
            console.warn("Storage profile corrupt, fallback to defaults.", err);
        }
    }

    if (!plannerState.detailedLogs) {
        plannerState.detailedLogs = [];
    }
    if (!plannerState.subjects || plannerState.subjects.length === 0) {
        plannerState.subjects.push({ id: "sub-general", name: "General Study", color: "#64748b" }); 
    }

    function syncStudyLogsFromDetailed() {
        plannerState.studyLogs = {};
        if (plannerState.detailedLogs) {
            plannerState.detailedLogs.forEach(log => {
                if (log.type === 'focus' && log.subjectId) {
                    plannerState.studyLogs[log.subjectId] = (plannerState.studyLogs[log.subjectId] || 0) + log.minutes;
                }
            });
        }
    }
    syncStudyLogsFromDetailed();

    const colorPickerGrid = document.getElementById('subject-color-picker');
    const subNameInput = document.getElementById('sub-new-name');
    const subCreateBtn = document.getElementById('sub-create-btn');
    const subListWrapper = document.getElementById('subject-list-container');
    
    const timerSubSelect = document.getElementById('timer-subject-select');
    const slotSubSelect = document.getElementById('slot-subject-select');
    const dayTabsContainer = document.getElementById('day-tabs-container');
    const timetableSlotsList = document.getElementById('timetable-slots');
    
    const addSlotTrigger = document.getElementById('add-slot-trigger');
    const slotModal = document.getElementById('slot-modal');
    const slotCancelBtn = document.getElementById('slot-cancel');
    const slotCancelBtnAlt = document.getElementById('slot-cancel-alt');
    const slotSaveBtn = document.getElementById('slot-save');
    const slotTimeInput = document.getElementById('slot-time');
    const slotNoteInput = document.getElementById('slot-note');

    const timerClock = document.getElementById('timer-clock');
    const timerStatusTag = document.getElementById('timer-status-tag');
    const timerActiveStroke = document.getElementById('timer-active-stroke');
    const timerFocusMinInput = document.getElementById('timer-focus-min');
    const timerBreakMinInput = document.getElementById('timer-break-min');
    const timerControlBtn = document.getElementById('timer-control-btn');
    const timerResetBtn = document.getElementById('timer-reset-btn');

    const statsEmptyMsg = document.getElementById('analytics-empty-msg');
    const statsList = document.getElementById('analytics-stats-list');
    const statsClearBtn = document.getElementById('analytics-clear-btn');

    const timerSoundToggle = document.getElementById('timer-sound-toggle');
    const timerWakeLockToggle = document.getElementById('timer-wakelock-toggle');
    const timerTimeBounds = document.getElementById('timer-time-bounds');
    const timerStartTimeSpan = document.getElementById('timer-start-time');
    const timerEndTimeSpan = document.getElementById('timer-end-time');
    const wakeLockLabelWrap = document.getElementById('wakelock-label-wrap');

    const graphModal = document.getElementById('graph-modal');
    const openGraphBtn = document.getElementById('open-graph-btn');
    const graphModalClose = document.getElementById('graph-modal-close');
    const graphLogFilter = document.getElementById('graph-log-filter');
    const graphVisualizationContainer = document.getElementById('graph-visualization-container');
    const graphDetailedLogList = document.getElementById('graph-detailed-log-list');

    function showToast(message, type = 'info') {
        const container = document.getElementById('studytimer-toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `studytimer-toast ${type}`;

        let icon = "ℹ️";
        if (type === 'error') icon = "❌";
        if (type === 'success') icon = "✅";
        if (type === 'warning') icon = "⚠️";

        toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => toast.classList.add('active'), 10);
        setTimeout(() => {
            toast.classList.remove('active');
            setTimeout(() => toast.remove(), 250);
        }, 4000);
    }

    if (!('wakeLock' in navigator)) {
        if (wakeLockLabelWrap) wakeLockLabelWrap.style.display = 'none';
    }

    function formatTimeAMPM(date) {
        let hours = date.getHours();
        let minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        minutes = minutes.toString().padStart(2, '0');
        return `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
    }

    async function toggleWakeLock(shouldLock) {
        if (!('wakeLock' in navigator)) return;
        try {
            if (shouldLock) {
                if (!wakeLockInstance) {
                    wakeLockInstance = await navigator.wakeLock.request('screen');
                }
            } else if (wakeLockInstance) {
                await wakeLockInstance.release();
                wakeLockInstance = null;
            }
        } catch (err) {
            console.warn("Wake Lock failed:", err);
            timerWakeLockToggle.checked = false;
        }
    }

    document.addEventListener('visibilitychange', async () => {
        if (wakeLockInstance !== null && document.visibilityState === 'visible') {
            await toggleWakeLock(true);
        }
    });

    function sendDesktopNotification(title, message) {
        if (!("Notification" in window)) return;
        if (Notification.permission === "granted") {
            new Notification(title, { body: message });
        }
    }

    function requestNotificationPermission() {
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }

    function playTimerTone(type) {
        if (!timerSoundToggle.checked) return;
        try {
            const ctx = getAudioContext();
            if (ctx.state === 'suspended') ctx.resume();

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            const now = ctx.currentTime;

            if (type === 'startFocus') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(261.63, now);
                osc.frequency.setValueAtTime(329.63, now + 0.15);
                osc.frequency.setValueAtTime(392.00, now + 0.30);
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
                gain.gain.setValueAtTime(0.25, now + 0.35);
                gain.gain.linearRampToValueAtTime(0, now + 0.50);
                osc.start(now); osc.stop(now + 0.55);
            } else if (type === 'endFocus') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880.00, now);
                osc.frequency.setValueAtTime(659.25, now + 0.15);
                osc.frequency.setValueAtTime(880.00, now + 0.30);
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
                gain.gain.setValueAtTime(0.35, now + 0.40);
                gain.gain.linearRampToValueAtTime(0, now + 0.60);
                osc.start(now); osc.stop(now + 0.65);
            } else if (type === 'startBreak') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(392.00, now);
                osc.frequency.setValueAtTime(329.63, now + 0.15);
                osc.frequency.setValueAtTime(261.63, now + 0.30);
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
                gain.gain.setValueAtTime(0.25, now + 0.35);
                gain.gain.linearRampToValueAtTime(0, now + 0.50);
                osc.start(now); osc.stop(now + 0.55);
            } else if (type === 'endBreak') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(349.23, now);
                osc.frequency.setValueAtTime(440.00, now + 0.15);
                osc.frequency.setValueAtTime(523.25, now + 0.30);
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
                gain.gain.setValueAtTime(0.25, now + 0.35);
                gain.gain.linearRampToValueAtTime(0, now + 0.50);
                osc.start(now); osc.stop(now + 0.55);
            }
        } catch (e) {
            console.warn("Audio Context failure", e);
        }
    }

    function saveStateToLocalDB() {
        localStorage.setItem('studytimer_planner_db_bytes', JSON.stringify(plannerState));
    }

    function renderColorSelectorGrid() {
        if (!colorPickerGrid) return;
        colorPickerGrid.innerHTML = "";
        SUBJECT_THEME_COLORS.forEach(color => {
            const bubble = document.createElement('div');
            bubble.className = "studytimer-color-bubble";
            if (color === activeColorHex) bubble.classList.add('active');
            bubble.style.backgroundColor = color;
            bubble.addEventListener('click', () => {
                activeColorHex = color;
                renderColorSelectorGrid();
            });
            colorPickerGrid.appendChild(bubble);
        });
    }

    function renderSubjectsLists() {
        if (!subListWrapper) return;
        subListWrapper.innerHTML = "";
        plannerState.subjects.forEach(subject => {
            const pill = document.createElement('span');
            pill.className = "studytimer-subject-pill";
            pill.style.borderLeft = `4px solid ${subject.color}`;
            pill.textContent = subject.name;

            const deleteCross = document.createElement('span');
            deleteCross.className = "studytimer-subject-pill-delete";
            deleteCross.textContent = "×";
            deleteCross.addEventListener('click', () => deleteSubject(subject.id));

            pill.appendChild(deleteCross);
            subListWrapper.appendChild(pill);
        });

        timerSubSelect.innerHTML = "";
        slotSubSelect.innerHTML = "";
        plannerState.subjects.forEach(subject => {
            const opt1 = document.createElement('option');
            opt1.value = subject.id;
            opt1.textContent = subject.name;
            timerSubSelect.appendChild(opt1);

            const opt2 = opt1.cloneNode(true);
            slotSubSelect.appendChild(opt2);
        });

        populateGraphFilters();
    }

    function populateGraphFilters() {
        if (!graphLogFilter) return;
        const currentSelection = graphLogFilter.value || "all";
        
        graphLogFilter.innerHTML = `
            <option value="all">All (Study &amp; Breaks)</option>
            <option value="focus">Total Study Only</option>
            <option value="break">Total Breaks Only</option>
        `;
        
        plannerState.subjects.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub.id;
            opt.textContent = `Sub: ${sub.name}`;
            graphLogFilter.appendChild(opt);
        });

        if ([...graphLogFilter.options].some(o => o.value === currentSelection)) {
            graphLogFilter.value = currentSelection;
        } else {
            graphLogFilter.value = "all";
        }
    }

    function deleteSubject(subjectId) {
        const targetSub = plannerState.subjects.find(s => s.id === subjectId);
        const subName = targetSub ? targetSub.name : "Subject";
        
        plannerState.subjects = plannerState.subjects.filter(s => s.id !== subjectId);
        
        if (plannerState.subjects.length === 0) {
            plannerState.subjects.push({ id: "sub-general", name: "General Study", color: "#64748b" });
            showToast("1 subject required. Added General Study.", "info");
        }
        
        for (let day in plannerState.timetable) {
            plannerState.timetable[day] = plannerState.timetable[day].filter(slot => slot.subjectId !== subjectId);
        }
        
        if (plannerState.detailedLogs) {
            plannerState.detailedLogs = plannerState.detailedLogs.filter(log => log.subjectId !== subjectId);
        }

        syncStudyLogsFromDetailed();
        saveStateToLocalDB();
        renderSubjectsLists();
        renderTimetableSlots();
        renderFocusAnalyticsList();
        renderProgressGraph();
        renderDetailedHistoryList();
        showToast(`Deleted "${subName}".`, "warning");
    }

    function renderTimetableSlots() {
        if (!timetableSlotsList) return;
        timetableSlotsList.innerHTML = "";
        const activeSlots = plannerState.timetable[currentDaySelection] || [];

        if (activeSlots.length === 0) {
            timetableSlotsList.innerHTML = `<div class="studytimer-empty-msg">No classes scheduled for ${currentDaySelection}.</div>`;
            return;
        }

        activeSlots.forEach(slot => {
            const subjectObject = plannerState.subjects.find(s => s.id === slot.subjectId);
            if (!subjectObject) return;

            const card = document.createElement('div');
            card.className = "studytimer-slot-card";
            card.style.borderLeftColor = subjectObject.color;

            card.innerHTML = `
                <div class="studytimer-slot-details">
                    <span class="studytimer-slot-subject">${subjectObject.name}</span>
                    <div class="studytimer-slot-meta">
                        <span>⏰ ${slot.time}</span>
                        ${slot.note ? `<span>📌 ${slot.note}</span>` : ''}
                    </div>
                </div>
            `;

            const deleteBtn = document.createElement('button');
            deleteBtn.className = "studytimer-btn-delete";
            deleteBtn.innerHTML = "&times;";
            deleteBtn.addEventListener('click', () => {
                plannerState.timetable[currentDaySelection] = activeSlots.filter(s => s.id !== slot.id);
                saveStateToLocalDB();
                renderTimetableSlots();
                showToast("Schedule slot removed.", "info");
            });

            card.appendChild(deleteBtn);
            timetableSlotsList.appendChild(card);
        });
    }

    function renderFocusAnalyticsList() {
        syncStudyLogsFromDetailed();
        if (!statsList) return;
        statsList.innerHTML = "";
        let logPairs = Object.entries(plannerState.studyLogs);
        logPairs = logPairs.filter(([subId]) => plannerState.subjects.some(s => s.id === subId));

        if (logPairs.length === 0) {
            if (statsEmptyMsg) statsEmptyMsg.style.display = 'block';
            if (statsClearBtn) statsClearBtn.style.display = 'none';
            return;
        }

        if (statsEmptyMsg) statsEmptyMsg.style.display = 'none';
        if (statsClearBtn) statsClearBtn.style.display = 'block';

        const maxMinutesRecorded = Math.max(...logPairs.map(([, mins]) => mins), 1);

        logPairs.forEach(([subjectId, totalMinutes]) => {
            const subject = plannerState.subjects.find(s => s.id === subjectId);
            if (!subject) return;

            const barPct = Math.min((totalMinutes / maxMinutesRecorded) * 100, 100);
            const statCard = document.createElement('div');
            statCard.className = "studytimer-stat-item";
            statCard.innerHTML = `
                <div class="studytimer-stat-label-row">
                    <span style="color:#0f172a;">${subject.name}</span>
                    <span style="color:${subject.color}; font-weight:700;">${totalMinutes} Min</span>
                </div>
                <div class="studytimer-stat-bar-track">
                    <div class="studytimer-stat-bar-fill" style="width: ${barPct}%; background-color: ${subject.color};"></div>
                </div>
            `;
            statsList.appendChild(statCard);
        });
    }

    function getLocalDateKey(timestamp) {
        const d = new Date(timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function calculateStreaks() {
        const logs = plannerState.detailedLogs || [];
        const focusLogs = logs.filter(log => log.type === 'focus');

        if (focusLogs.length === 0) {
            return { current: 0, best: 0 };
        }

        const dateStrings = focusLogs.map(log => getLocalDateKey(log.timestamp));
        const uniqueDates = [...new Set(dateStrings)].sort();

        if (uniqueDates.length === 0) {
            return { current: 0, best: 0 };
        }

        const parseDateKey = (key) => {
            const [y, m, d] = key.split('-').map(Number);
            return new Date(y, m - 1, d); 
        };

        let bestStreak = 0;
        let currentChain = 0;
        let prevDate = null;

        for (let i = 0; i < uniqueDates.length; i++) {
            const currDate = parseDateKey(uniqueDates[i]);
            if (prevDate === null) {
                currentChain = 1;
            } else {
                const diffTime = currDate - prevDate;
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays === 1) {
                    currentChain++;
                } else if (diffDays > 1) {
                    if (currentChain > bestStreak) {
                        bestStreak = currentChain;
                    }
                    currentChain = 1;
                }
            }
            prevDate = currDate;
        }
        if (currentChain > bestStreak) {
            bestStreak = currentChain;
        }

        const todayKey = getLocalDateKey(Date.now());
        const yesterdayObj = new Date();
        yesterdayObj.setDate(yesterdayObj.getDate() - 1);
        const yesterdayKey = getLocalDateKey(yesterdayObj.getTime());

        let currentStreak = 0;
        const lastStudyDayKey = uniqueDates[uniqueDates.length - 1];

        if (lastStudyDayKey === todayKey || lastStudyDayKey === yesterdayKey) {
            currentStreak = 1;
            let tempPrevDate = parseDateKey(lastStudyDayKey);

            for (let i = uniqueDates.length - 2; i >= 0; i--) {
                const currDate = parseDateKey(uniqueDates[i]);
                const diffTime = tempPrevDate - currDate;
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays === 1) {
                    currentStreak++;
                    tempPrevDate = currDate;
                } else {
                    break;
                }
            }
        }

        return { current: currentStreak, best: bestStreak };
    }

    function renderProgressGraph() {
        if (!graphVisualizationContainer) return;

        const logs = plannerState.detailedLogs || [];
        
        const dayLabels = [];
        const dayKeys = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dayLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
            dayKeys.push(getLocalDateKey(d.getTime()));
        }

        const focusData = new Array(7).fill(0);
        const breakData = new Array(7).fill(0);
        const subjectDataMap = {};

        plannerState.subjects.forEach(s => {
            subjectDataMap[s.id] = new Array(7).fill(0);
        });

        logs.forEach(item => {
            const logDayKey = getLocalDateKey(item.timestamp);
            const dayIdx = dayKeys.indexOf(logDayKey);
            if (dayIdx !== -1) {
                if (item.type === 'focus') {
                    focusData[dayIdx] += item.minutes;
                    if (subjectDataMap[item.subjectId]) {
                        subjectDataMap[item.subjectId][dayIdx] += item.minutes;
                    }
                } else if (item.type === 'break') {
                    breakData[dayIdx] += item.minutes;
                }
            }
        });

        const isSmallMobile = window.innerWidth < 400;

        const svgWidth = 550;
        const svgHeight = isSmallMobile ? 400 : 300;

        const paddingLeft = isSmallMobile ? 35 : 45;
        const paddingRight = isSmallMobile ? 15 : 20;
        const paddingTop = 30;
        const paddingBottom = 30;

        const plotWidth = svgWidth - paddingLeft - paddingRight;
        const plotHeight = svgHeight - paddingTop - paddingBottom;

        const activeFilter = graphLogFilter.value || "all";
        let maxVal = 60; 

        if (activeFilter === 'all') {
            const combinedMax = Math.max(...focusData, ...breakData);
            if (combinedMax > maxVal) maxVal = combinedMax;
        } else if (activeFilter === 'focus') {
            const focusMax = Math.max(...focusData);
            if (focusMax > maxVal) maxVal = focusMax;
        } else if (activeFilter === 'break') {
            const breakMax = Math.max(...breakData);
            if (breakMax > maxVal) maxVal = breakMax;
        } else {
            const subId = activeFilter;
            if (subjectDataMap[subId]) {
                const subMax = Math.max(...subjectDataMap[subId]);
                if (subMax > maxVal) maxVal = subMax;
            }
        }

        maxVal = Math.ceil(maxVal / 10) * 10; 

        const getX = (idx) => paddingLeft + (idx / 6) * plotWidth;
        const getY = (val) => paddingTop + plotHeight - (val / maxVal) * plotHeight;

        const getSplineCurve = (dataArray) => {
            const points = dataArray.map((val, idx) => ({ x: getX(idx), y: getY(val) }));
            if (points.length === 0) return "";
            let pathStr = `M ${points[0].x} ${points[0].y}`;
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[i];
                const p1 = points[i + 1];
                const cpX1 = p0.x + (p1.x - p0.x) / 3;
                const cpY1 = p0.y;
                const cpX2 = p0.x + 2 * (p1.x - p0.x) / 3;
                const cpY2 = p1.y;
                pathStr += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
            }
            return pathStr;
        };

        const getAreaClosedPath = (dataArray) => {
            const curve = getSplineCurve(dataArray);
            if (!curve) return "";
            return `${curve} L ${getX(6)} ${paddingTop + plotHeight} L ${getX(0)} ${paddingTop + plotHeight} Z`;
        };

        let svgHtml = `
        <svg viewBox="0 0 ${svgWidth} ${svgHeight}" style="width:100%; height:auto; display:block; overflow:visible;">
            <defs>
                <linearGradient id="focusGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0"/>
                </linearGradient>
                <linearGradient id="breakGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#10b981" stop-opacity="0.2"/>
                    <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>
                </linearGradient>
                <linearGradient id="customSubGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" id="customSubStop" stop-color="#8b5cf6" stop-opacity="0.25"/>
                    <stop offset="100%" id="customSubStopEnd" stop-color="#8b5cf6" stop-opacity="0.0"/>
                </linearGradient>
            </defs>
        `;

        const ticks = 4;
        for (let i = 0; i <= ticks; i++) {
            const val = (maxVal / ticks) * i;
            const y = getY(val);
            svgHtml += `
                <line x1="${paddingLeft}" y1="${y}" x2="${svgWidth - paddingRight}" y2="${y}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4" />
                <text x="${paddingLeft - 8}" y="${y + 3}" fill="#64748b" font-size="12" font-weight="700" text-anchor="end">${Math.round(val)}m</text>
            `;
        }

        dayLabels.forEach((lbl, idx) => {
            svgHtml += `<text x="${getX(idx)}" y="${paddingTop + plotHeight + 18}" fill="#64748b" font-size="12.5" font-weight="700" text-anchor="middle">${lbl}</text>`;
        });

        let legendHtml = "";
        if (activeFilter === 'all') {
            legendHtml = `
                <g transform="translate(${paddingLeft + 10}, 15)" font-size="13" font-weight="700">
                    <circle cx="0" cy="0" r="4" fill="#3b82f6" />
                    <text x="8" y="3.5" fill="#475569">Focus Blocks</text>
                    <circle cx="110" cy="0" r="4" fill="#10b981" />
                    <text x="118" y="3.5" fill="#475569">Breaks</text>
                </g>
            `;
            
            svgHtml += `
                <path d="${getAreaClosedPath(focusData)}" fill="url(#focusGrad)" />
                <path d="${getSplineCurve(focusData)}" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" />
            `;
            svgHtml += `
                <path d="${getAreaClosedPath(breakData)}" fill="url(#breakGrad)" />
                <path d="${getSplineCurve(breakData)}" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" />
            `;

            focusData.forEach((val, idx) => {
                svgHtml += `
                    <g class="studytimer-graph-point">
                        <circle cx="${getX(idx)}" cy="${getY(val)}" r="5" fill="#ffffff" stroke="#3b82f6" stroke-width="2.5" />
                        <title>Study: ${val} Min</title>
                    </g>
                `;
            });
            breakData.forEach((val, idx) => {
                svgHtml += `
                    <g class="studytimer-graph-point">
                        <circle cx="${getX(idx)}" cy="${getY(val)}" r="5" fill="#ffffff" stroke="#10b981" stroke-width="2.5" />
                        <title>Break: ${val} Min</title>
                    </g>
                `;
            });

        } else if (activeFilter === 'focus') {
            legendHtml = `
                <g transform="translate(${paddingLeft + 10}, 15)" font-size="13" font-weight="700">
                    <circle cx="0" cy="0" r="4" fill="#3b82f6" />
                    <text x="8" y="3.5" fill="#475569">Study Focus Time</text>
                </g>
            `;
            svgHtml += `
                <path d="${getAreaClosedPath(focusData)}" fill="url(#focusGrad)" />
                <path d="${getSplineCurve(focusData)}" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" />
            `;
            focusData.forEach((val, idx) => {
                svgHtml += `
                    <g class="studytimer-graph-point">
                        <circle cx="${getX(idx)}" cy="${getY(val)}" r="5" fill="#ffffff" stroke="#3b82f6" stroke-width="2.5" />
                        <title>Study: ${val} Min</title>
                    </g>
                `;
            });

        } else if (activeFilter === 'break') {
            legendHtml = `
                <g transform="translate(${paddingLeft + 10}, 15)" font-size="13" font-weight="700">
                    <circle cx="0" cy="0" r="4" fill="#10b981" />
                    <text x="8" y="3.5" fill="#475569">Break Time</text>
                </g>
            `;
            svgHtml += `
                <path d="${getAreaClosedPath(breakData)}" fill="url(#breakGrad)" />
                <path d="${getSplineCurve(breakData)}" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" />
            `;
            breakData.forEach((val, idx) => {
                svgHtml += `
                    <g class="studytimer-graph-point">
                        <circle cx="${getX(idx)}" cy="${getY(val)}" r="5" fill="#ffffff" stroke="#10b981" stroke-width="2.5" />
                        <title>Break: ${val} Min</title>
                    </g>
                `;
            });

        } else {
            const sub = plannerState.subjects.find(s => s.id === activeFilter);
            const color = sub ? sub.color : "#8b5cf6";
            const name = sub ? sub.name : "Subject";
            const targetSubData = subjectDataMap[activeFilter] || new Array(7).fill(0);

            svgHtml = svgHtml.replace('id="customSubStop" stop-color="#8b5cf6"', `id="customSubStop" stop-color="${color}"`);
            svgHtml = svgHtml.replace('id="customSubStopEnd" stop-color="#8b5cf6"', `id="customSubStopEnd" stop-color="${color}"`);

            legendHtml = `
                <g transform="translate(${paddingLeft + 10}, 15)" font-size="13" font-weight="700">
                    <circle cx="0" cy="0" r="4" fill="${color}" />
                    <text x="8" y="3.5" fill="#475569">${name} Focus</text>
                </g>
            `;

            svgHtml += `
                <path d="${getAreaClosedPath(targetSubData)}" fill="url(#customSubGrad)" />
                <path d="${getSplineCurve(targetSubData)}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" />
            `;
            targetSubData.forEach((val, idx) => {
                svgHtml += `
                    <g class="studytimer-graph-point">
                        <circle cx="${getX(idx)}" cy="${getY(val)}" r="5" fill="#ffffff" stroke="${color}" stroke-width="2.5" />
                        <title>${name}: ${val} Min</title>
                    </g>
                `;
            });
        }

        svgHtml += legendHtml + `</svg>`;
        graphVisualizationContainer.innerHTML = svgHtml;
    }

    function renderDetailedHistoryList() {
        if (!graphDetailedLogList || !graphLogFilter) return;

        const currentFilter = graphLogFilter.value || "all";
        let logs = plannerState.detailedLogs || [];

        let focusSum = 0;
        let breakSum = 0;
        logs.forEach(item => {
            if (item.type === 'focus') focusSum += item.minutes;
            if (item.type === 'break') breakSum += item.minutes;
        });

        document.getElementById('stat-total-focus').textContent = `${focusSum} Min`;
        document.getElementById('stat-total-break').textContent = `${breakSum} Min`;

     const streakData = calculateStreaks();

document.getElementById('stat-current-streak').textContent =
`${streakData.current} Days`;

document.getElementById('stat-best-streak').textContent =
`${streakData.best} Days`;

const bestStreakEl = document.getElementById('stat-best-stk');

if (bestStreakEl) {
    bestStreakEl.textContent = streakData.best;
}
        logs = [...logs].sort((a, b) => b.timestamp - a.timestamp);

        if (currentFilter === 'focus') {
            logs = logs.filter(item => item.type === 'focus');
        } else if (currentFilter === 'break') {
            logs = logs.filter(item => item.type === 'break');
        } else if (currentFilter !== 'all') {
            logs = logs.filter(item => item.type === 'focus' && item.subjectId === currentFilter);
        }

        if (logs.length === 0) {
            graphDetailedLogList.innerHTML = `<div class="studytimer-empty-msg studytimer-empty-graph-msg">No logs matching filter selection.</div>`;
            return;
        }

        graphDetailedLogList.innerHTML = "";
        logs.forEach(log => {
            const dateRef = new Date(log.timestamp);
            const formattedTimeStr = `${dateRef.toLocaleDateString()} ${formatTimeAMPM(dateRef)}`;
            
            const row = document.createElement('div');
            row.className = "studytimer-log-row";

            let labelTitle = "Break Period";
            let badgeClass = "break";
            let badgeText = "Break";

            if (log.type === 'focus') {
                const subObj = plannerState.subjects.find(s => s.id === log.subjectId);
                labelTitle = subObj ? subObj.name : "Unassigned Study Session";
                badgeClass = "focus";
                badgeText = "Study";
            }

            row.innerHTML = `
                <div class="studytimer-log-info">
                    <span class="studytimer-log-badge ${badgeClass}">${badgeText}</span>
                    <div style="display:flex; flex-direction:column; min-width:0;">
                        <span style="font-weight:700; color:#0f172a; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                            ${labelTitle}
                        </span>
                        <span style="font-size:0.75rem; color:#64748b;">${formattedTimeStr} &nbsp;|&nbsp; ${log.minutes} Min</span>
                    </div>
                </div>
            `;

            const delButton = document.createElement('button');
            delButton.className = "studytimer-log-btn-del";
            delButton.innerHTML = "x";
            delButton.title = "Delete record";
            delButton.addEventListener('click', () => {
                deleteSessionLog(log.id);
            });

            row.appendChild(delButton);
            graphDetailedLogList.appendChild(row);
        });
    }

    function deleteSessionLog(logId) {
        plannerState.detailedLogs = plannerState.detailedLogs.filter(item => item.id !== logId);
        syncStudyLogsFromDetailed();
        saveStateToLocalDB();
        renderFocusAnalyticsList();
        renderProgressGraph();
        renderDetailedHistoryList();
        showToast("Session log removed.", "warning");
    }

    function updateTimeBoundsDisplay() {
        if (!isTimerRunning) {
            timerTimeBounds.classList.add('hidden');
            timerStartTimeSpan.textContent = ''; 
            timerEndTimeSpan.textContent = '';  
            return;
        }
        const now = new Date();
        const sessionEnd = new Date(now.getTime() + (totalSecondsRemaining * 1000));
        timerStartTimeSpan.textContent = `Start: ${formatTimeAMPM(now)}`;
        timerEndTimeSpan.textContent = `End: ${formatTimeAMPM(sessionEnd)}`;
        timerTimeBounds.classList.remove('hidden');
    }

    function updateDigitalTimerUI() {
        const mins = Math.floor(totalSecondsRemaining / 60);
        const secs = totalSecondsRemaining % 60;
        timerClock.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        const pct = totalSecondsRemaining / initialTimerBlockSeconds;
        const offset = 628 - (628 * pct);
        timerActiveStroke.style.strokeDashoffset = offset;
    }


    function runTimerInterval() {
        if (timerInterval) clearInterval(timerInterval);
        
        if (!timerEndTimeStamp) {
            timerEndTimeStamp = Date.now() + (totalSecondsRemaining * 1000);
            localStorage.setItem('studytimer_timer_end', timerEndTimeStamp);
        }
        
        timerInterval = setInterval(() => {
            const now = Date.now();
            totalSecondsRemaining = Math.max(0, Math.ceil((timerEndTimeStamp - now) / 1000));
            
            updateDigitalTimerUI();
            
            localStorage.setItem('studytimer_timer_remaining', totalSecondsRemaining);
            
            if (totalSecondsRemaining <= 0) {
                handlePhaseCompletion();
            }
        }, 1000);
    }

    function handlePhaseCompletion() {
        clearInterval(timerInterval);
        timerInterval = null;
        timerEndTimeStamp = null;
        isTimerRunning = false;
        
        localStorage.removeItem('studytimer_timer_running');
        localStorage.removeItem('studytimer_timer_end');
        localStorage.removeItem('studytimer_timer_remaining');
        
        toggleWakeLock(false);

        if (activeTimerMode === "focus") {
            playTimerTone('endFocus');
            sendDesktopNotification("Focus Finished!", "Focus block completed successfully! Your break starts now.");

            const selectedSubject = timerSubSelect.value;
            const logMinutes = currentSessionMinutes || parseInt(timerFocusMinInput.value) || 25;
            let subjectIdToLog = selectedSubject;

            if (!subjectIdToLog && plannerState.subjects.length > 0) {
                subjectIdToLog = plannerState.subjects[0].id;
            } else if (plannerState.subjects.length === 0) {
                const fallbackSub = { id: "sub-general", name: "General Study", color: "#64748b" };
                plannerState.subjects.push(fallbackSub);
                renderSubjectsLists();
                subjectIdToLog = fallbackSub.id;
            }

            plannerState.detailedLogs.push({
                id: `log-${Date.now()}`,
                type: "focus",
                subjectId: subjectIdToLog,
                minutes: logMinutes,
                timestamp: Date.now()
            });

            syncStudyLogsFromDetailed();
            saveStateToLocalDB();
            renderFocusAnalyticsList();
            renderProgressGraph();
            renderDetailedHistoryList();
            showToast(`Logged ${logMinutes} mins of Focus study!`, "success");

            activeTimerMode = "break";
            timerStatusTag.textContent = "Break Period";
            timerStatusTag.style.color = "#10b981";
            timerActiveStroke.style.stroke = "#10b981";
            timerActiveStroke.style.filter = "drop-shadow(0 0 8px rgba(16, 185, 129, 0.6))";
            timerControlBtn.textContent = "Pause Break";
            timerControlBtn.className = "studytimer-btn studytimer-btn-danger";

            const breakMins = parseInt(timerBreakMinInput.value) || 5;
            currentSessionMinutes = breakMins;
            totalSecondsRemaining = breakMins * 60;
            initialTimerBlockSeconds = breakMins * 60;

            updateDigitalTimerUI();
            updateTimeBoundsDisplay();
            playTimerTone('startBreak');
            showToast("Break started automatically!", "success");

            isTimerRunning = true;
            
            timerEndTimeStamp = Date.now() + (totalSecondsRemaining * 1000);
            localStorage.setItem('studytimer_timer_running', 'true');
            localStorage.setItem('studytimer_timer_end', timerEndTimeStamp);
            localStorage.setItem('studytimer_timer_mode', 'break');
            localStorage.setItem('studytimer_timer_initial', initialTimerBlockSeconds);
            localStorage.setItem('studytimer_timer_session_mins', currentSessionMinutes);

            runTimerInterval();

        } else {
            playTimerTone('endBreak');
            sendDesktopNotification("Session Complete!", "Your study focus & break cycle is finished! Take a longer rest.");

            const logMinutes = currentSessionMinutes || parseInt(timerBreakMinInput.value) || 5;
            plannerState.detailedLogs.push({
                id: `log-${Date.now()}`,
                type: "break",
                minutes: logMinutes,
                timestamp: Date.now()
            });

            syncStudyLogsFromDetailed();
            saveStateToLocalDB();
            renderFocusAnalyticsList();
            renderProgressGraph();
            renderDetailedHistoryList();
            showToast(`Logged ${logMinutes} mins of Break! Full cycle complete.`, "success");

            activeTimerMode = "focus";
            timerStatusTag.textContent = ""; 
            timerStatusTag.style.color = "#a5b4fc";
            timerActiveStroke.style.stroke = "#6366f1";
            timerActiveStroke.style.filter = "drop-shadow(0 0 8px rgba(99, 102, 241, 0.6))";

            const focusMins = parseInt(timerFocusMinInput.value) || 25;
            currentSessionMinutes = focusMins;
            totalSecondsRemaining = focusMins * 60;
            initialTimerBlockSeconds = focusMins * 60;

            updateDigitalTimerUI();
            timerTimeBounds.classList.add('hidden');
            
            timerControlBtn.textContent = "Start Focus";
            timerControlBtn.className = "studytimer-btn studytimer-btn-primary";
            timerResetBtn.disabled = true;
            
            isTimerRunning = false;
        }
    }

    function triggerTimerStateChange() {
        requestNotificationPermission();
        const context = getAudioContext();
        if (context.state === 'suspended') {
            context.resume();
        }

        if (isTimerRunning) {
            clearInterval(timerInterval);
            timerInterval = null;
            timerEndTimeStamp = null;
            isTimerRunning = false;
            
            timerControlBtn.textContent = activeTimerMode === "focus" ? "Resume Focus" : "Resume Break";
            timerControlBtn.className = "studytimer-btn studytimer-btn-primary";
            
            updateTimeBoundsDisplay(); 
            toggleWakeLock(false);
            
            localStorage.setItem('studytimer_timer_running', 'false');
            localStorage.setItem('studytimer_timer_remaining', totalSecondsRemaining);
            localStorage.removeItem('studytimer_timer_end');
            
            showToast("Timer paused.", "info");
        } else {
            isTimerRunning = true;
            timerResetBtn.disabled = false;
            
            timerControlBtn.textContent = activeTimerMode === "focus" ? "Pause Focus" : "Pause Break";
            timerControlBtn.className = "studytimer-btn studytimer-btn-danger";

            if (totalSecondsRemaining === initialTimerBlockSeconds) {
                const targetMinutes = activeTimerMode === "focus" 
                    ? (parseInt(timerFocusMinInput.value) || 25)
                    : (parseInt(timerBreakMinInput.value) || 5);
                currentSessionMinutes = targetMinutes;
                totalSecondsRemaining = targetMinutes * 60;
                initialTimerBlockSeconds = targetMinutes * 60;
            }

            if (activeTimerMode === "focus") {
                timerStatusTag.textContent = "Focus"; 
                playTimerTone('startFocus');
                showToast("Focus session started!", "success");
            } else {
                timerStatusTag.textContent = "Break Period";
                playTimerTone('startBreak');
                showToast("Break session started!", "success");
            }

            updateTimeBoundsDisplay();
            
            timerEndTimeStamp = Date.now() + (totalSecondsRemaining * 1000);
            localStorage.setItem('studytimer_timer_running', 'true');
            localStorage.setItem('studytimer_timer_end', timerEndTimeStamp);
            localStorage.setItem('studytimer_timer_mode', activeTimerMode);
            localStorage.setItem('studytimer_timer_initial', initialTimerBlockSeconds);
            localStorage.setItem('studytimer_timer_session_mins', currentSessionMinutes);

            if (timerWakeLockToggle.checked) {
                toggleWakeLock(true);
            }

            runTimerInterval();
        }
    }

    function handleResetTimer() {
        clearInterval(timerInterval);
        timerInterval = null;
        timerEndTimeStamp = null;
        isTimerRunning = false;
        
        localStorage.removeItem('studytimer_timer_running');
        localStorage.removeItem('studytimer_timer_end');
        localStorage.removeItem('studytimer_timer_remaining');
        
        activeTimerMode = "focus";
        timerStatusTag.textContent = ""; 
        timerStatusTag.style.color = "#a5b4fc";
        timerActiveStroke.style.stroke = "#6366f1";
        timerActiveStroke.style.filter = "drop-shadow(0 0 8px rgba(99, 102, 241, 0.6))";

        const focusMins = parseInt(timerFocusMinInput.value) || 25;
        totalSecondsRemaining = focusMins * 60;
        initialTimerBlockSeconds = focusMins * 60;
        currentSessionMinutes = focusMins;

        updateDigitalTimerUI();
        updateTimeBoundsDisplay(); 
        toggleWakeLock(false);

        timerControlBtn.textContent = "Start Focus";
        timerControlBtn.className = "studytimer-btn studytimer-btn-primary";
        timerResetBtn.disabled = true;
        showToast("Timer reset.", "info");
    }

    subCreateBtn.addEventListener('click', () => {
        const rawName = subNameInput.value.trim();
        
        if (!rawName) {
            showToast("Please enter a valid Subject Title.", "error");
            return;
        }
        if (rawName.length > 50) {
            showToast("Subject title cannot exceed 50 characters.", "error");
            return;
        }
        
        const isDuplicate = plannerState.subjects.some(
            sub => sub.name.toLowerCase() === rawName.toLowerCase()
        );
        if (isDuplicate) {
            showToast(`"${rawName}" already exists!`, "warning");
            return;
        }

        const newId = `sub-${Date.now()}`;
        plannerState.subjects.push({
            id: newId,
            name: rawName,
            color: activeColorHex
        });

        saveStateToLocalDB();
        renderSubjectsLists();
        subNameInput.value = "";
        showToast(`Subject "${rawName}" added!`, "success");
    });

    document.querySelectorAll('.studytimer-day-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.studytimer-day-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDaySelection = btn.dataset.day;
            renderTimetableSlots();
        });
    });

    addSlotTrigger.addEventListener('click', () => {
        if (plannerState.subjects.length === 0) {
            showToast("Please create a subject first.", "warning");
            return;
        }
        slotModal.classList.add('active');
    });

    const closeModalFunc = () => {
        slotModal.classList.remove('active');
        slotTimeInput.value = "";
        slotNoteInput.value = "";
    };
    slotCancelBtn.addEventListener('click', closeModalFunc);
    if (slotCancelBtnAlt) slotCancelBtnAlt.addEventListener('click', closeModalFunc);

    slotSaveBtn.addEventListener('click', () => {
        const subId = slotSubSelect.value;
        const rawTime = slotTimeInput.value.trim();
        const rawNote = slotNoteInput.value.trim();

        if (!subId) {
            showToast("Please select a subject.", "error");
            return;
        }
        if (!rawTime) {
            showToast("Please enter a time range slot.", "error");
            return;
        }
        if (rawTime.length > 50) {
            showToast("Time input entry is too long.", "error");
            return;
        }
        if (rawNote.length > 100) {
            showToast("Additional note is too long (Max 100 characters).", "error");
            return;
        }

        const targetDayArray = plannerState.timetable[currentDaySelection] || [];
        targetDayArray.push({
            id: `slot-${Date.now()}`,
            subjectId: subId,
            time: rawTime,
            note: rawNote
        });

        plannerState.timetable[currentDaySelection] = targetDayArray;
        saveStateToLocalDB();
        renderTimetableSlots();

        slotModal.classList.remove('active');
        slotTimeInput.value = "";
        slotNoteInput.value = "";
        showToast("Schedule slot saved!", "success");
    });

    openGraphBtn.addEventListener('click', () => {
        renderProgressGraph();
        renderDetailedHistoryList();
        graphModal.classList.add('active');
    });

    graphModalClose.addEventListener('click', () => {
        graphModal.classList.remove('active');
    });

    graphLogFilter.addEventListener('change', () => {
        renderProgressGraph();
        renderDetailedHistoryList();
    });

    window.addEventListener('click', (e) => {
        if (e.target === graphModal) {
            graphModal.classList.remove('active');
        }
        if (e.target === slotModal) {
            slotModal.classList.remove('active');
            slotTimeInput.value = "";
            slotNoteInput.value = "";
        }
    });

    timerControlBtn.addEventListener('click', triggerTimerStateChange);
    timerResetBtn.addEventListener('click', handleResetTimer);

    timerWakeLockToggle.addEventListener('change', (e) => {
        if (isTimerRunning) {
            toggleWakeLock(e.target.checked);
        }
    });

    timerFocusMinInput.addEventListener('change', () => {
        let focusVal = parseInt(timerFocusMinInput.value);
        if (isNaN(focusVal) || focusVal < 1) {
            showToast("Focus duration must be at least 1 minute.", "error");
            timerFocusMinInput.value = 25;
            focusVal = 25;
        } else if (focusVal > 720) {
            showToast("Focus block duration cannot exceed 12 hours.", "warning");
            timerFocusMinInput.value = 720;
            focusVal = 720;
        }

        if (!isTimerRunning && activeTimerMode === "focus") {
            totalSecondsRemaining = focusVal * 60;
            initialTimerBlockSeconds = focusVal * 60;
            currentSessionMinutes = focusVal;
            updateDigitalTimerUI();
        }
    });

    timerBreakMinInput.addEventListener('change', () => {
        let breakVal = parseInt(timerBreakMinInput.value);
        if (isNaN(breakVal) || breakVal < 1) {
            showToast("Break duration must be at least 1 minute.", "error");
            timerBreakMinInput.value = 5;
            breakVal = 5;
        } else if (breakVal > 180) {
            showToast("Break block duration cannot exceed 180 minutes.", "warning");
            timerBreakMinInput.value = 180;
            breakVal = 180;
        }

        if (!isTimerRunning && activeTimerMode === "break") {
            totalSecondsRemaining = breakVal * 60;
            initialTimerBlockSeconds = breakVal * 60;
            currentSessionMinutes = breakVal;
            updateDigitalTimerUI();
        }
    });

    statsClearBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to clear your logged study hours?")) {
            plannerState.studyLogs = {};
            plannerState.detailedLogs = [];
            saveStateToLocalDB();
            renderFocusAnalyticsList();
            renderProgressGraph();
            renderDetailedHistoryList();
            showToast("Logged analytics cleared.", "info");
        }
    });


    async function generatePDFReport() {
        const overlay = document.getElementById('pdf-generating-overlay');
        if (overlay) {
            overlay.classList.add('active');
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        try {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) {
                showToast("PDF generation libraries are loading. Please try again.", "warning");
                if (overlay) overlay.classList.remove('active');
                return;
            }

            const doc = new jsPDF('p', 'mm', 'a4');
            const pageWidth = doc.internal.pageSize.getWidth(); 
            const pageHeight = doc.internal.pageSize.getHeight(); 
            const margin = 15;
            let currentY = 15;

      const addFooter = (pdfInstance, pageNum) => {
    pdfInstance.setFont("helvetica", "normal");
    pdfInstance.setFontSize(9);

    pdfInstance.setTextColor(37, 99, 235); 

    const siteText = "docdesk.in";
    pdfInstance.text(siteText, margin, pageHeight - 10);

    const textWidth = pdfInstance.getTextWidth(siteText);

    pdfInstance.link(
        margin,
        pageHeight - 14,
        textWidth,
        6,
        { url: "https://docdesk.in" }
    );

    pdfInstance.setTextColor(100, 116, 139);
    pdfInstance.text(
        `Page ${pageNum}`,
        pageWidth - margin,
        pageHeight - 10,
        { align: 'right' }
    );
};
            doc.setFillColor(37, 99, 235); 
            doc.rect(0, 0, pageWidth, 28, 'F');
            
            doc.setFont("helvetica", "bold");
            doc.setFontSize(18);
            doc.setTextColor(255, 255, 255);
            doc.text("DocDesk Study Records", margin, 18);
            
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            const formatOptions = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
            doc.text(`Generated: ${new Date().toLocaleString('en-US', formatOptions)}`, pageWidth - margin, 18, { align: 'right' });
            
            currentY = 38;
            addFooter(doc, 1);

            try {
                const tempCaptureDiv = document.createElement('div');
                tempCaptureDiv.style.position = 'absolute';
                tempCaptureDiv.style.left = '-9999px';
                tempCaptureDiv.style.top = '0';
                tempCaptureDiv.style.width = '600px';
                tempCaptureDiv.style.background = '#ffffff';
                tempCaptureDiv.style.padding = '24px';
                tempCaptureDiv.style.borderRadius = '16px';
                tempCaptureDiv.style.display = 'flex';
                tempCaptureDiv.style.flexDirection = 'column';
                tempCaptureDiv.style.gap = '20px';
                tempCaptureDiv.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                
                const graphClone = graphVisualizationContainer.cloneNode(true);
                const svgInClone = graphClone.querySelector('svg');
                if (svgInClone) {
                    svgInClone.style.minWidth = '100%';
                }
                
                const statsGridClone = document.getElementById('performance-stats-grid').cloneNode(true);
                
                tempCaptureDiv.appendChild(graphClone);
                tempCaptureDiv.appendChild(statsGridClone);
                document.body.appendChild(tempCaptureDiv);
                
                const canvas = await html2canvas(tempCaptureDiv, {
                    scale: 2, 
                    useCORS: true,
                    backgroundColor: '#ffffff'
                });
                
                document.body.removeChild(tempCaptureDiv);
                
                const imgData = canvas.toDataURL('image/jpeg', 1.0);
                const imgWidth = pageWidth - (margin * 2); 
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                
                doc.setFont("helvetica", "bold");
                doc.setFontSize(13);
                doc.setTextColor(15, 23, 42); 
                doc.text("Analytics", margin, currentY);
                currentY += 5;
                
                doc.addImage(imgData, 'JPEG', margin, currentY, imgWidth, imgHeight);
                currentY += imgHeight + 10;
            } catch (err) {
                console.warn("Visual snapshot generation failed, continuing with direct data charts.", err);
                
                doc.setFont("helvetica", "bold");
                doc.setFontSize(13);
                doc.setTextColor(15, 23, 42); 
                doc.text("Analytics Summary", margin, currentY);
                currentY += 6;
                
                const focusMinutesText = document.getElementById('stat-total-focus')?.textContent || "0 Min";
                const breakMinutesText = document.getElementById('stat-total-break')?.textContent || "0 Min";
                const currentStreakText = document.getElementById('stat-current-streak')?.textContent || "0 Days";
                const bestStreakText = document.getElementById('stat-best-streak')?.textContent || "0 Days";
                
                doc.setFont("helvetica", "normal");
                doc.setFontSize(10);
                doc.text(`Total Focus Time: ${focusMinutesText}`, margin + 5, currentY);
                currentY += 5;
                doc.text(`Total Break Time: ${breakMinutesText}`, margin + 5, currentY);
                currentY += 5;
                doc.text(`Current Study Streak: ${currentStreakText}`, margin + 5, currentY);
                currentY += 5;
                doc.text(`Best Study Streak: ${bestStreakText}`, margin + 5, currentY);
                currentY += 12;
            }

            const subjectSummaries = [];
            plannerState.subjects.forEach(sub => {
                const mins = plannerState.studyLogs[sub.id] || 0;
                subjectSummaries.push([sub.name, `${mins} Min`]);
            });

            doc.setFont("helvetica", "bold");
            doc.setFontSize(13);
            doc.setTextColor(15, 23, 42);
            doc.text("Subject Summary", margin, currentY);
            currentY += 4;

            let pageCount = 1;

            doc.autoTable({
                startY: currentY,
                head: [['Subject Title', 'Accumulated Study Duration']],
                body: subjectSummaries.length > 0 ? subjectSummaries : [['No study sessions recorded', '0 Min']],
                margin: { left: margin, right: margin },
                styles: { fontSize: 9.5, cellPadding: 3, font: "helvetica" },
                headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' }, // Brand Blue
                alternateRowStyles: { fillColor: [248, 250, 252] },
                didDrawPage: (data) => {
                    if (data.pageNumber > pageCount) {
                        pageCount = data.pageNumber;
                        addFooter(doc, pageCount);
                    }
                }
            });

            currentY = doc.lastAutoTable.finalY + 12;

            const timetableData = [];
            const daysOrdered = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
            daysOrdered.forEach(day => {
                const slots = plannerState.timetable[day] || [];
                slots.forEach(slot => {
                    const subObj = plannerState.subjects.find(s => s.id === slot.subjectId);
                    const subName = subObj ? subObj.name : "General Subject";
                    timetableData.push([day, subName, slot.time, slot.note || "-"]);
                });
            });

            if (currentY > pageHeight - 35) {
                doc.addPage();
                pageCount++;
                addFooter(doc, pageCount);
                currentY = 20;
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(13);
            doc.setTextColor(15, 23, 42);
            doc.text("Planned Weekly Schedule", margin, currentY);
            currentY += 4;

            doc.autoTable({
                startY: currentY,
                head: [['Day', 'Subject', 'Time Span', 'Session Notes']],
                body: timetableData.length > 0 ? timetableData : [['-', 'No sessions scheduled', '-', '-']],
                margin: { left: margin, right: margin },
                styles: { fontSize: 9, cellPadding: 3, font: "helvetica" },
                headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: 'bold' }, 
                alternateRowStyles: { fillColor: [248, 250, 252] },
                didDrawPage: (data) => {
                    if (data.pageNumber > pageCount) {
                        pageCount = data.pageNumber;f
                        addFooter(doc, pageCount);
                    }
                }
            });

            currentY = doc.lastAutoTable.finalY + 12;

            const historyData = [];
            const sortedLogs = [...(plannerState.detailedLogs || [])].sort((a, b) => b.timestamp - a.timestamp);
            sortedLogs.forEach(log => {
                const typeLabel = log.type === 'focus' ? 'Study' : 'Break';
                let subName = "-";
                if (log.type === 'focus') {
                    const subObj = plannerState.subjects.find(s => s.id === log.subjectId);
                    subName = subObj ? subObj.name : "General Study";
                }
                const dateRef = new Date(log.timestamp);
                const dateText = `${dateRef.toLocaleDateString()} ${formatTimeAMPM(dateRef)}`;
                historyData.push([typeLabel, subName, dateText, `${log.minutes} Min`]);
            });

            if (currentY > pageHeight - 35) {
                doc.addPage();
                pageCount++;
                addFooter(doc, pageCount);
                currentY = 20;
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(13);
            doc.setTextColor(15, 23, 42);
            doc.text("Activity Logs History", margin, currentY);
            currentY += 4;

            doc.autoTable({
                startY: currentY,
                head: [['Type', 'Subject', 'Session Date & Time', 'Duration']],
                body: historyData.length > 0 ? historyData : [['-', 'No logs recorded', '-', '-']],
                margin: { left: margin, right: margin },
                styles: { fontSize: 9, cellPadding: 3, font: "helvetica" },
                headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' }, // Brand Blue
                alternateRowStyles: { fillColor: [248, 250, 252] },
                didDrawPage: (data) => {
                    if (data.pageNumber > pageCount) {
                        pageCount = data.pageNumber;
                        addFooter(doc, pageCount);
                    }
                }
            });

            doc.save("DocDesk Study Records.pdf");
        } catch (err) {
            console.error("PDF compiling processing failure: ", err);
        } finally {
            if (overlay) {
                overlay.classList.remove('active');
            }
        }
    }

    renderColorSelectorGrid();
    renderSubjectsLists();
    renderTimetableSlots();
    renderFocusAnalyticsList();


    const savedRunning = localStorage.getItem('studytimer_timer_running') === 'true';
    if (savedRunning) {
        const savedEnd = parseInt(localStorage.getItem('studytimer_timer_end'));
        const savedMode = localStorage.getItem('studytimer_timer_mode') || 'focus';
        const savedInitial = parseInt(localStorage.getItem('studytimer_timer_initial')) || 1500;
        const savedSessionMins = parseInt(localStorage.getItem('studytimer_timer_session_mins')) || 25;
        
        if (savedEnd && savedEnd > Date.now()) {
            activeTimerMode = savedMode;
            initialTimerBlockSeconds = savedInitial;
            currentSessionMinutes = savedSessionMins;
            timerEndTimeStamp = savedEnd;
            totalSecondsRemaining = Math.ceil((savedEnd - Date.now()) / 1000);
            isTimerRunning = true;
            
            timerStatusTag.textContent = activeTimerMode === "focus" ? "Focus Block" : "Break Period";
            timerStatusTag.style.color = activeTimerMode === "focus" ? "#a5b4fc" : "#10b981";
            timerActiveStroke.style.stroke = activeTimerMode === "focus" ? "#6366f1" : "#10b981";
            timerActiveStroke.style.filter = activeTimerMode === "focus" ? "drop-shadow(0 0 8px rgba(99, 102, 241, 0.6))" : "drop-shadow(0 0 8px rgba(16, 185, 129, 0.6))";
            
            timerControlBtn.textContent = activeTimerMode === "focus" ? "Pause Focus" : "Pause Break";
            timerControlBtn.className = "studytimer-btn studytimer-btn-danger";
            timerResetBtn.disabled = false;
            
            updateDigitalTimerUI();
            updateTimeBoundsDisplay();
            runTimerInterval();
            
            if (timerWakeLockToggle.checked) {
                toggleWakeLock(true);
            }
        } else {
            localStorage.removeItem('studytimer_timer_running');
            localStorage.removeItem('studytimer_timer_end');
            handleResetTimer();
        }
    } else {
        timerStatusTag.textContent = "";
    }


    const timetableModal = document.getElementById('timetable-modal');
    const subjectsModal = document.getElementById('subjects-modal');
    const statsModal = document.getElementById('stats-modal');

    document.getElementById('btn-show-timetable').addEventListener('click', () => {
        timetableModal.classList.add('active');
    });

    document.getElementById('btn-show-subjects').addEventListener('click', () => {
        subjectsModal.classList.add('active');
    });

    document.getElementById('btn-show-stats').addEventListener('click', () => {
        statsModal.classList.add('active');
    });

    const modalGraphBtn = document.getElementById('open-graph-btn-modal');
    if (modalGraphBtn) {
        modalGraphBtn.addEventListener('click', () => {
            statsModal.classList.remove('active');
            openGraphBtn.click();
        });
    }

    document.querySelectorAll('.studytimer-close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-close');
            const target = document.getElementById(modalId);
            if (target) target.classList.remove('active');
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target === timetableModal) timetableModal.classList.remove('active');
        if (e.target === subjectsModal) subjectsModal.classList.remove('active');
        if (e.target === statsModal) statsModal.classList.remove('active');
    });

    document.getElementById('download-pdf-btn-graph').addEventListener('click', generatePDFReport);

})();
