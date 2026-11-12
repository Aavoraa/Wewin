import { describe, expect, it } from 'vitest';
import { CERTIFICATE_EXPIRY_WARN_DAYS, billCertificateProblem, certificateStatus, zVendorFormInput, zVendorInput } from './masters';

const base = { code: 'KNT-01', name: 'Sri Murugan Knitting' };

describe('vendor certificate (Q-074)', () => {
  it('API schema: certificate is optional, but number and expiry go together', () => {
    expect(zVendorInput.safeParse(base).success).toBe(true);
    const noExpiry = zVendorInput.safeParse({ ...base, certificateNo: 'OEKO-123' });
    expect(noExpiry.success).toBe(false);
    expect(noExpiry.error?.flatten().fieldErrors.certificateExpiry).toBeDefined();
    const noNumber = zVendorInput.safeParse({ ...base, certificateExpiry: '2027-03-31' });
    expect(noNumber.success).toBe(false);
    expect(noNumber.error?.flatten().fieldErrors.certificateNo).toBeDefined();
    const both = zVendorInput.parse({ ...base, certificateNo: ' OEKO-123 ', certificateExpiry: '2027-03-31' });
    expect(both).toMatchObject({ certificateNo: 'OEKO-123', certificateExpiry: '2027-03-31' });
  });

  it('vendor form schema requires both and a real date', () => {
    const empty = zVendorFormInput.safeParse(base);
    expect(empty.success).toBe(false);
    expect(Object.keys(empty.error?.flatten().fieldErrors ?? {}).sort()).toEqual(['certificateExpiry', 'certificateNo']);
    expect(zVendorFormInput.safeParse({ ...base, certificateNo: 'C-1', certificateExpiry: '2027-02-30' }).success).toBe(false);
    expect(zVendorFormInput.safeParse({ ...base, certificateNo: 'C-1', certificateExpiry: '2027-02-28' }).success).toBe(true);
  });

  it('status: missing, expired, expiring within the warning window, valid', () => {
    const today = '2026-11-12';
    expect(certificateStatus(null, today)).toEqual({ status: 'MISSING', daysLeft: null });
    expect(certificateStatus('2026-11-11', today)).toEqual({ status: 'EXPIRED', daysLeft: -1 });
    expect(certificateStatus('2026-11-12', today)).toEqual({ status: 'EXPIRING', daysLeft: 0 });
    expect(certificateStatus('2026-12-12', today)).toEqual({ status: 'EXPIRING', daysLeft: CERTIFICATE_EXPIRY_WARN_DAYS });
    expect(certificateStatus('2026-12-13', today)).toEqual({ status: 'VALID', daysLeft: 31 });
    expect(certificateStatus('2026-11-20', today, 5).status).toBe('VALID');
  });
});

describe('billing against the vendor certificate (Q-074)', () => {
  const v = { name: 'Sri Murugan Knitting', certificateNo: 'GOTS-118', certificateExpiry: '2026-11-30' };
  const today = '2026-11-12';

  it('allows a bill while the certificate is in force, through its last day', () => {
    expect(billCertificateProblem(v, '2026-11-10', today)).toBeNull();
    expect(billCertificateProblem(v, '2026-11-30', '2026-11-30')).toBeNull();
  });

  it('refuses when expired today, even for a back-dated bill', () => {
    expect(billCertificateProblem(v, '2026-11-20', '2026-12-01')).toContain('expired on 2026-11-30');
  });

  it('refuses a bill dated after the expiry', () => {
    expect(billCertificateProblem(v, '2026-12-05', today)).toContain('GOTS-118');
  });

  it('refuses when the vendor has no certificate', () => {
    expect(billCertificateProblem({ ...v, certificateNo: null, certificateExpiry: null }, today, today)).toContain('no certificate');
  });
});
