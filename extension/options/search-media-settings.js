(function () {
  'use strict';

  const settings = globalThis.SearchMediaSettings;
  const container = document.getElementById('search-media-sites');
  const status = document.getElementById('search-media-status');
  if (!settings || !container || !status) return;

  const controls = new Map();
  const pending = new Set();
  let saved = settings.normalize();
  let ready = false;
  let revision = 0;
  let saveFailed = false;

  function render() {
    for (const [domain, control] of controls) {
      control.checked = saved[domain];
      control.disabled = !ready || pending.has(domain);
    }
  }

  settings.subscribe((value) => {
    revision += 1;
    saved = value;
    ready = true;
    render();
  });

  for (const site of settings.sites) {
    const label = document.createElement('label');
    label.className = 'search-media-choice';
    const control = document.createElement('input');
    control.type = 'checkbox';
    control.name = site.domain;
    control.checked = saved[site.domain];
    control.disabled = true;
    const text = document.createElement('span');
    text.textContent = site.label;
    label.append(control, text);
    container.append(label);
    controls.set(site.domain, control);

    control.addEventListener('change', async () => {
      const enabled = control.checked;
      pending.add(site.domain);
      control.disabled = true;
      saveFailed = false;
      status.textContent = '正在保存';
      try {
        const startRevision = revision;
        const result = await settings.setEnabled(site.domain, enabled);
        if (revision === startRevision) saved = result;
      } catch (_) {
        saveFailed = true;
        // Use current persisted choices for rollback if another settings page changed them.
        const startRevision = revision;
        try {
          const result = await settings.read();
          if (revision === startRevision) saved = result;
        } catch (_) {}
      } finally {
        pending.delete(site.domain);
        render();
        status.textContent = pending.size ? '正在保存' : saveFailed ? '保存失败' : '已保存';
      }
    });
  }

  const initialRevision = revision;
  settings.read().then((value) => {
    if (revision === initialRevision) saved = value;
    ready = true;
    render();
  }).catch(() => {
    if (revision === initialRevision) status.textContent = '读取失败';
    render();
  });
})();
