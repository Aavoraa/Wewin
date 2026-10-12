import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { type OrderInput, todayIst, zOrderInput, zOrderUpdate } from '@wewin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DocumentForm, Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { ErrorState, LoadingState } from '@/components/states';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatQty } from '@/lib/format';
import { ChipsInput, MatrixEditor, type MatrixCell } from './MatrixEditor';
import { type OrderDetail, pickers, useOrder } from './api';
import { OrderTabs } from './OrderTabs';

type ComponentRow = GridRow & { code: string; name: string; panelItemId: string; pcsPerGarment: number | string };
type FormValues = Omit<OrderInput, 'components' | 'lines'> & { components: ComponentRow[]; lines: MatrixCell[]; version?: number };

function toForm(o: OrderDetail): FormValues {
  return {
    orderNo: o.orderNo,
    buyerId: o.buyerId,
    buyerPoNo: o.buyerPoNo,
    poDate: o.poDate,
    shipDate: o.shipDate ?? '',
    styleNo: o.styleNo,
    styleName: o.styleName ?? '',
    description: o.description ?? '',
    garmentItemId: o.garmentItemId,
    currency: o.currency,
    colours: o.colours,
    sizes: o.sizes,
    lines: o.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty, unitPrice: l.unitPrice })),
    components: o.components.map((c) => ({ _key: c.id, code: c.code, name: c.name, panelItemId: c.panelItemId, pcsPerGarment: c.pcsPerGarment })),
    remarks: o.remarks ?? '',
    version: o.version,
  };
}

const blank: FormValues = {
  orderNo: '',
  buyerId: '',
  buyerPoNo: '',
  poDate: todayIst(),
  shipDate: '',
  styleNo: '',
  styleName: '',
  description: '',
  garmentItemId: '',
  currency: 'USD',
  colours: [],
  sizes: [],
  lines: [],
  components: [{ _key: newKey(), code: 'FRONT', name: 'Front', panelItemId: '', pcsPerGarment: 1 }],
  remarks: '',
};

/** Order document: header, colour × size matrix, garment components; costing, programs and trims BOM below. */
export function OrderPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useOrder(id);
  const o = q.data;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver((isNew ? zOrderInput : zOrderUpdate) as never),
    defaultValues: blank,
  });
  const e = form.formState.errors;

  useEffect(() => {
    if (o) {
      form.reset(toForm(o));
      setLabels({
        [o.buyerId]: o.buyer.name,
        [o.garmentItemId]: o.garmentItem.name,
        ...Object.fromEntries(o.components.map((c) => [c.panelItemId, c.panelItem.name])),
      });
    }
  }, [o, form]);

  if (!isNew && q.isLoading) return <LoadingState />;
  if (!isNew && q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const status = o?.status ?? 'DRAFT';
  const editable = (status === 'DRAFT' || status === 'CONFIRMED') && can('orders.create');
  const lockedOnConfirm = status === 'CONFIRMED';
  const colours = form.watch('colours');
  const sizes = form.watch('sizes');
  const currency = form.watch('currency');

  const refresh = async (next?: OrderDetail) => {
    if (next) qc.setQueryData(['order', next.id], next);
    await qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const save = () =>
    new Promise<void>((resolve, reject) => {
      void form.handleSubmit(
        async (v) => {
          try {
            const payload = { ...v, lines: v.lines.filter((l) => v.colours.includes(l.colour) && v.sizes.includes(l.size)) };
            if (isNew) {
              const created = await api.post<OrderDetail>('/orders', payload);
              await refresh(created);
              navigate(`/orders/${created.id}`, { replace: true });
            } else {
              await refresh(await api.patch<OrderDetail>(`/orders/${id}`, payload));
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error('Please correct the highlighted fields')),
      )();
    });

  const act = (path: string, body?: object) => async () => refresh(await api.post<OrderDetail>(`/orders/${id}/${path}`, body));

  return (
    <DocumentForm
      title="Order"
      docNo={o?.orderNo}
      status={status}
      backHref="/orders"
      editable={editable}
      canPost={!isNew && can('orders.confirm')}
      postLabel="Confirm"
      postDescription="Confirming makes the order available for programs and production. Quantities can still be amended; components and buyer are locked."
      canCancel={can('orders.close')}
      cancelStatuses={['DRAFT', 'CONFIRMED']}
      cancelDescription="Cancelling is refused once stock documents or approved programs reference the order."
      canClose={can('orders.close')}
      closeStatuses={['CONFIRMED']}
      closeDescription="Closing marks the order complete. No new documents can be raised against it."
      onSave={save}
      onPost={act('confirm')}
      onCancel={isNew ? undefined : (reason) => act('cancel', { reason })()}
      onClose={(reason) => act('close', { reason })()}
      onDelete={isNew ? undefined : async () => {
        await api.del(`/orders/${id}`);
        await refresh();
        navigate('/orders');
      }}
      header={
        <>
          <Field label="Order no. *" error={e.orderNo?.message}>
            <Input {...form.register('orderNo')} disabled={lockedOnConfirm} aria-invalid={!!e.orderNo} autoFocus={isNew} />
          </Field>
          <Field label="Buyer *" error={e.buyerId?.message}>
            <Controller
              control={form.control}
              name="buyerId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/buyers"
                  map={pickers.buyer}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  disabled={lockedOnConfirm || !editable}
                  rememberKey="buyer"
                  invalid={!!e.buyerId}
                  onChange={(opt) => {
                    field.onChange(opt?.id ?? '');
                    const b = opt?.data as { currency?: string } | undefined;
                    if (b?.currency && isNew) form.setValue('currency', b.currency);
                  }}
                />
              )}
            />
          </Field>
          <Field label="Buyer PO no. *" error={e.buyerPoNo?.message}>
            <Input {...form.register('buyerPoNo')} />
          </Field>
          <Field label="PO date *" error={e.poDate?.message}>
            <Input type="date" {...form.register('poDate')} />
          </Field>
          <Field label="Style no. *" error={e.styleNo?.message}>
            <Input {...form.register('styleNo')} />
          </Field>
          <Field label="Style name">
            <Input {...form.register('styleName')} />
          </Field>
          <Field label="Style item (garment) *" error={e.garmentItemId?.message}>
            <Controller
              control={form.control}
              name="garmentItemId"
              render={({ field }) => (
                <EntityPicker
                  endpoint="/items"
                  query={{ type: 'GARMENT' }}
                  map={pickers.item}
                  value={field.value}
                  valueLabel={labels[field.value]}
                  disabled={lockedOnConfirm || !editable}
                  invalid={!!e.garmentItemId}
                  onChange={(opt) => field.onChange(opt?.id ?? '')}
                />
              )}
            />
          </Field>
          <Field label="Ship date" error={e.shipDate?.message}>
            <Input type="date" {...form.register('shipDate')} />
          </Field>
          <Field label="Currency *" error={e.currency?.message}>
            <Input {...form.register('currency')} maxLength={3} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2 xl:col-span-3">
            <Input {...form.register('remarks')} />
          </Field>
        </>
      }
      lines={
        <>
          <Card>
            <CardHeader>
              <CardTitle>Colour × size quantities</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Controller
                  control={form.control}
                  name="colours"
                  render={({ field }) => (
                    <ChipsInput label="Colours" placeholder="Type colour, Enter" value={field.value} onChange={field.onChange} disabled={!editable} />
                  )}
                />
                <Controller
                  control={form.control}
                  name="sizes"
                  render={({ field }) => (
                    <ChipsInput label="Sizes (in order)" placeholder="e.g. S, M, L — Enter" value={field.value} onChange={field.onChange} disabled={!editable} />
                  )}
                />
              </div>
              {e.colours || e.sizes || e.lines ? (
                <div className="text-xs text-destructive">{e.colours?.message ?? e.sizes?.message ?? e.lines?.message ?? 'Check the matrix'}</div>
              ) : null}
              <Controller
                control={form.control}
                name="lines"
                render={({ field }) => (
                  <MatrixEditor colours={colours} sizes={sizes} lines={field.value} onChange={field.onChange} disabled={!editable} currency={currency} />
                )}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Garment components (panels per garment)</CardTitle>
            </CardHeader>
            <CardContent>
              <Controller
                control={form.control}
                name="components"
                render={({ field }) => (
                  <LineGrid<ComponentRow>
                    rows={field.value}
                    onChange={field.onChange}
                    readOnly={!editable || lockedOnConfirm}
                    newRow={() => ({ _key: newKey(), code: '', name: '', panelItemId: '', pcsPerGarment: 1 })}
                    addLabel="Add component"
                    errors={Object.fromEntries(
                      ((e.components as unknown as { code?: { message?: string }; panelItemId?: { message?: string } }[] | undefined) ?? []).map((x, i) => [
                        i,
                        { code: x?.code?.message, panelItemId: x?.panelItemId?.message },
                      ]),
                    )}
                    columns={[
                      { key: 'code', header: 'Code', width: '120px', placeholder: 'FRONT' },
                      { key: 'name', header: 'Name', placeholder: 'Front' },
                      {
                        key: 'panelItemId',
                        header: 'Panel item',
                        width: '260px',
                        display: !editable || lockedOnConfirm ? (r) => labels[r.panelItemId] ?? '—' : undefined,
                        render: (r, i, update) => (
                          <EntityPicker
                            endpoint="/items"
                            query={{ type: 'PANEL' }}
                            map={pickers.item}
                            value={r.panelItemId}
                            valueLabel={labels[r.panelItemId]}
                            cellId={`${i}:2`}
                            onChange={(opt) => {
                              if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                              update({ panelItemId: opt?.id ?? '' } as Partial<ComponentRow>);
                            }}
                          />
                        ),
                      },
                      { key: 'pcsPerGarment', header: 'Pcs / garment', type: 'pcs', width: '120px' },
                    ]}
                  />
                )}
              />
              {typeof e.components?.message === 'string' ? <div className="mt-1 text-xs text-destructive">{e.components.message}</div> : null}
            </CardContent>
          </Card>
        </>
      }
      aside={
        o ? (
          <Card>
            <CardContent className="grid gap-1 text-sm">
              <div className="text-xs text-muted-foreground">Order quantity</div>
              <div className="text-2xl font-semibold">{formatQty(o.totals.pcs)} pcs</div>
              <div className="text-xs text-muted-foreground">
                {o.colours.length} colours × {o.sizes.length} sizes · {o.buyer.name}
              </div>
            </CardContent>
          </Card>
        ) : null
      }
      footer={o ? <OrderTabs order={o} /> : null}
    />
  );
}
