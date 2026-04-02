export interface PaymentInstallment {
  dueDate: string;
  amount: string;
  description?: string;
}

export interface PaymentPlan {
  installments: PaymentInstallment[];
  financeCharge?: string;
}

export interface LocationPremium {
  locationNumber: number;
  premium: string;
  description?: string;
}
