import CreditControlPage from './CreditControlPage';

function EasyBuyGoodClientsPage() {
  return (
    <CreditControlPage
      initialSection="clients"
      clientFilter="good"
      title="Credit Sale Good Clients"
      description="Customers with good repayment behaviour, low risk, and strong credit sale history."
    />
  );
}

export default EasyBuyGoodClientsPage;
