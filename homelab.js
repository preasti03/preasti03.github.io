(function () {
    const trigger = document.getElementById('run-trigger');
    const output  = document.getElementById('run-output');
    if (!trigger || !output) return;

    const LINES = [
        { t: '[*] detecting hardware...',                        c: 'ao-head', p: 0   },
        { t: '    host  Proxmox VE 9.2  (Debian 13)',            c: 'ao-dim',  p: 300 },
        { t: '    cpu   AMD Ryzen 5 1600  (6c / 12t)',           c: 'ao-dim',  p: 70  },
        { t: '    ram   16 GB DDR4',                             c: 'ao-dim',  p: 70  },
        { t: '    gpu   GTX 1660 Super  (NVENC + CUDA)',         c: 'ao-dim',  p: 70  },
        { t: '    disk  1 TB NVMe  (OS + containers)',           c: 'ao-dim',  p: 70  },
        { t: '    nas   ZFS mirror  2× 4 TB  (~3.6 TB usable)', c: 'ao-dim', p: 70 },
        { t: '',                                                 c: '',        p: 60  },
        { t: '[+] starting services...',                         c: 'ao-head', p: 180 },
        { t: '    ✓  Pi-hole ×2       DNS · ad blocking · redundant sync',      c: 'ao-ok', p: 280 },
        { t: '    ✓  Tailscale        VPN subnet router  (zero open ports)',                   c: 'ao-ok', p: 110 },
        { t: '    ✓  Home Assistant   home automation  (VM)',                                  c: 'ao-ok', p: 110 },
        { t: '    ✓  Jellyfin         media server  · NVENC transcode',                  c: 'ao-ok', p: 110 },
        { t: '    ✓  Immich           photo backup  · NVENC + CUDA ML',                  c: 'ao-ok', p: 110 },
        { t: '    ✓  Minecraft        Bedrock crossplay  · outbound tunnel',              c: 'ao-ok', p: 110 },
        { t: '    ✓  Finance tracker  Flask + gunicorn  · live NAS data',                c: 'ao-ok', p: 110 },
        { t: '    ✓  Uptime Kuma      monitoring on Pi  (survives server crash)',               c: 'ao-ok', p: 110 },
        { t: '',                                                 c: '',        p: 60  },
        { t: '[+] network...',                                   c: 'ao-head', p: 180 },
        { t: '    ISP → building → TP-Link Deco',      c: 'ao-dim',  p: 280 },
        { t: '                          │',                 c: 'ao-dim',  p: 55  },
        { t: '                 Proxmox host',                    c: 'ao-dim',  p: 55  },
        { t: '                 ├── NVMe  (OS, containers)', c: 'ao-dim', p: 55 },
        { t: '                 ├── ZFS mirror  (3.6 TB)',   c: 'ao-dim', p: 55 },
        { t: '                 ├── 6× LXC containers', c: 'ao-dim', p: 55 },
        { t: '                 └── 1× VM  (Home Assistant OS)', c: 'ao-dim', p: 55 },
        { t: '',                                                 c: '',        p: 55  },
        { t: '    remote   Tailscale  (no open ports)',          c: 'ao-dim',  p: 55  },
        { t: '    public   outbound tunnel  (Minecraft only)',   c: 'ao-dim',  p: 55  },
        { t: '',                                                 c: '',        p: 60  },
        { t: '[*] 8 services · 6 LXC · 1 VM · 1 Pi · ready.', c: 'ao-head', p: 350 },
    ];

    let running = false;

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    async function runAnimation() {
        if (running) return;
        running = true;
        trigger.classList.add('running');
        output.innerHTML = '';

        for (const { t, c, p } of LINES) {
            await sleep(p);
            const span = document.createElement('span');
            if (c) span.className = c;
            span.textContent = t + '\n';
            output.appendChild(span);
        }

        const cur = document.createElement('span');
        cur.className = 'cursor';
        cur.textContent = '█';
        output.appendChild(cur);

        running = false;
        trigger.classList.remove('running');
        trigger.classList.add('done');
    }

    function handleActivate() {
        if (running) return;
        trigger.classList.remove('done');
        setTimeout(runAnimation, 10);
    }

    trigger.addEventListener('click', handleActivate);
    trigger.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleActivate();
        }
    });
}());
