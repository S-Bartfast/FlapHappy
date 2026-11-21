// In-sim toolbar panel. Finds the desktop app on localhost and shows its display.
// Plain XHR: Coherent GT has no fetch. One port at a time so a closed port cannot stall the sim.
var FH_PORT = 47321;
var FH_RETRY_MS = 5000;

function fhAsk(cb) {
    var done = false;
    var xhr = null;
    var finish = function (ok) {
        if (done) return;
        done = true;
        cb(ok);
    };
    try {
        xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            var ok = false;
            if (xhr.status === 200) {
                try {
                    var j = JSON.parse(xhr.responseText);
                    ok = !!j && j.app === 'Flap Happy';
                } catch (e) { ok = false; }
            }
            finish(ok);
        };
        xhr.onerror = function () { finish(false); };
        xhr.ontimeout = function () { finish(false); };
        xhr.open('GET', 'http://127.0.0.1:' + FH_PORT + '/version?t=' + Date.now(), true);
        xhr.timeout = 1500;
        xhr.send();
    } catch (e) {
        finish(false);
    }
    setTimeout(function () {
        if (done) return;
        try { if (xhr) xhr.abort(); } catch (e2) { }
        finish(false);
    }, 2500);
}

function fhNote(panel, show) {
    var note = panel._fhNote || document.getElementById('FlapHappyNote');
    panel._fhNote = note;
    if (!note) return;
    note.style.display = show ? 'block' : 'none';
}

function fhConnect(panel) {
    panel._fhGen = (panel._fhGen || 0) + 1;
    if (panel._fhTimer) clearTimeout(panel._fhTimer);
    var gen = panel._fhGen;
    var attempt = function () {
        fhAsk(function (ok) {
            if (!panel.panelActive || panel._fhGen !== gen || !panel.iframeElement) return;
            if (ok) {
                fhNote(panel, false);
                if (!panel._fhLoaded) {
                    panel._fhLoaded = true;
                    panel.iframeElement.src = 'http://127.0.0.1:' + FH_PORT + '/panel.html?t=' + Date.now();
                }
                return;
            }
            panel._fhLoaded = false;
            fhNote(panel, true);
            panel._fhTimer = setTimeout(attempt, FH_RETRY_MS);
        });
    };
    attempt();
}

function fhDisconnect(panel) {
    panel._fhGen = (panel._fhGen || 0) + 1;
    panel._fhLoaded = false;
    if (panel._fhTimer) clearTimeout(panel._fhTimer);
    panel._fhTimer = null;
    fhNote(panel, false);
}

class IngamePanelFlapHappy extends TemplateElement {
    constructor() {
        super();
        this.panelActive = false;
        this.ingameUi = null;
        this.iframeElement = null;
        this.initialize();
    }
    connectedCallback() {
        super.connectedCallback();
        var self = this;
        this.ingameUi = this.querySelector('ingame-ui');
        this.iframeElement = document.getElementById('FlapHappyFrame');
        if (!this.ingameUi) return;
        this.ingameUi.addEventListener('panelActive', function () {
            self.panelActive = true;
            fhConnect(self);
        });
        this.ingameUi.addEventListener('panelInactive', function () {
            self.panelActive = false;
            fhDisconnect(self);
            if (self.iframeElement) self.iframeElement.src = '';
        });
    }
    initialize() {
        document.body.classList.add('interact');
    }
    disconnectedCallback() {
        super.disconnectedCallback();
    }
}
window.customElements.define('flaphappy-ingamepanel', IngamePanelFlapHappy);
checkAutoload();
