import { describe, expect, it } from 'vitest';
import { emailChannel, emailContent } from './channels';

describe('email channel (Q-064)', () => {
  it('is off until SMTP is configured', () => {
    expect(emailChannel.isConfigured()).toBe(false);
  });

  it('lists the body lines, escapes HTML and links back to the document', () => {
    const { text, html } = emailContent({ title: 'Cutting lay CUT/26-27/0001 posted', body: 'By Owner\nFabric <30s>: 7.500 kg · Fabric store → Consumed', link: 'https://erp.example.test/cut-lays/1' });
    expect(text).toContain('Fabric <30s>: 7.500 kg');
    expect(text).toContain('Open: https://erp.example.test/cut-lays/1');
    expect(html).toContain('<li style="margin:2px 0">Fabric &lt;30s&gt;: 7.500 kg');
    expect(html).toContain('href="https://erp.example.test/cut-lays/1"');
  });
});
