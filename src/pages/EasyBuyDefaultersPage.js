import CreditControlPage from './CreditControlPage';

function EasyBuyDefaultersPage() {
  return (
    <CreditControlPage
      initialSection="clients"
      clientFilter="risky"
      title="Credit Sale Defaulters"
      description="Customers with overdue balances, late payments, or risky credit sale repayment behaviour."
    />
  );
}

export default EasyBuyDefaultersPage;
