export type CardAction =
  | 'advanceStart'
  | 'advanceMumbai'
  | 'advanceBengaluru'
  | 'advanceJaipur'
  | 'advanceAirport'
  | 'advanceSteamer'
  | 'advanceTransport'
  | 'advanceRailway'
  | 'advanceVaranasi'
  | 'advanceAhmedabad'
  | 'advanceKolkata'
  | 'advanceGurugram'
  | 'nearestTransport'
  | 'nearestUtility'
  | 'back3'
  | 'jail'
  | 'jailfree'
  | 'repair'
  | 'audit'
  | 'weddingHost'
  | 'weddingGift'
  | 'radioContest'
  | 'radioContest200'
  | 'chairman'
  | 'birthday';

export type Card = {
  text: string;
  amount?: number;
  action?: CardAction;
};

export const chanceCards: Card[] = [
  { text: 'Express Train to CST Mumbai: Advance directly to Mumbai (Tile 39). If you pass START, collect ₹1,500.', action: 'advanceMumbai' },
  { text: 'Heritage Tourism Grant: Advance to Jaipur (Tile 16). Receive a royal tourism grant of ₹1,000. If you pass START, collect ₹1,500.', action: 'advanceJaipur', amount: 1000 },
  { text: 'Tech IPO in Bengaluru: Silicon Plateau unicorn listing! Advance to Bengaluru (Tile 34). Collect ₹1,500 dividend. If you pass START, collect ₹1,500.', action: 'advanceBengaluru', amount: 1500 },
  { text: 'Monsoon Flight Diversion: Heavy rains over the Deccan. Divert directly to Airport (Tile 15). If you pass START, collect ₹1,500.', action: 'advanceAirport' },
  { text: 'Port Congestion on Arabian Sea: Steamer voyage docked! Advance to Steamer (Tile 25). If you pass START, collect ₹1,500.', action: 'advanceSteamer' },
  { text: 'Fast-track National Highway: Green signal on the Golden Quadrilateral. Advance to Transport (Tile 35). If you pass START, collect ₹1,500.', action: 'advanceTransport' },
  { text: 'Transit Hub Express: Advance to the nearest Transit Hub. If owned, pay twice the normal rental dues to the owner.', action: 'nearestTransport' },
  { text: 'Urgent Telegram: Advance to the nearest Utility (Post Office or Radio Station). If owned, pay 2× regular utility dues.', action: 'nearestUtility' },
  { text: 'Rush to START: Fast-lane sprint to START! Collect your ₹1,500 salary immediately.', action: 'advanceStart' },
  { text: 'Cyber City Business Summit: High-stakes tech conference in Gurugram! Advance to Gurugram (Tile 37). If you pass START, collect ₹1,500.', action: 'advanceGurugram' },
  { text: 'Silk Board Junction Gridlock: Bengaluru peak-hour traffic standoff! Go back 3 spaces.', action: 'back3' },
  { text: 'Bollywood Box Office Royalty: Your blockbuster soundtrack went viral worldwide! Collect ₹2,000 royalty.', amount: 2000 },
  { text: 'IPL Cricket Franchise Sponsorship: Premier T20 title jersey branding deal finalized! Collect ₹1,800 payout.', amount: 1800 },
  { text: 'Radio Mirchi Live Call-in Contest: You gave the superhit answer! Win ₹150 × dice roll.', action: 'radioContest' },
  { text: 'Diwali Festival Dhamaka Bonus: Grand corporate festive ex-gratia bonus! Collect ₹1,500.', amount: 1500 },
  { text: 'ISRO Aerospace Vendor Contract: Navigation satellite payload component approved. Collect ₹1,000 grant.', amount: 1000 },
  { text: 'Solar Rooftop Clean Energy Subsidy: Ministry of New & Renewable Energy subsidy approved. Collect ₹600.', amount: 600 },
  { text: 'Reserve Bank Treasury Bill: Short-term sovereign T-bill matured with interest. Collect ₹400.', amount: 400 },
  { text: 'Marine Drive Speeding Fine: Caught speeding past Nariman Point! Pay ₹500 into the Tax Pool.', amount: -500 },
  { text: 'GST Assessment & Tax Audit: Directorate General of GST Intelligence audit. Pay ₹150 for each house and ₹400 for each hotel.', action: 'audit' },
  { text: 'Big Fat Indian Wedding: You host the extravagant Sangeet night! Pay ₹150 to every player for banquet catering.', action: 'weddingHost' },
  { text: 'Temple Trust Charity Donation: Contribute ₹300 for community langar, prasad, and pilgrim guest house restoration.', amount: -300 },
  { text: 'Expressway Toll Gate Challan: Low FASTag balance penalty on the Yamuna Expressway. Pay ₹250.', amount: -250 },
  { text: 'Securities Board Investigation: Financial irregularities discovered. Go directly to Jail! Do not pass START, do not collect ₹1,500.', action: 'jail' },
  { text: 'VIP Lok Sabha Pass: Official Parliamentary exemption pass! Get Out of Jail Free. Keep this card until needed or trade it.', action: 'jailfree' }
];

export const chestCards: Card[] = [
  { text: 'Annual Founder Dividend: Advance to START and collect your ₹1,500 annual compensation.', action: 'advanceStart' },
  { text: 'Board the Vande Bharat Express: Semi-high-speed express route! Advance to Railway (Tile 5). If you pass START, collect ₹1,500.', action: 'advanceRailway' },
  { text: 'Ganga Aarti Pilgrimage: Spiritual tour of ancient Dashashwamedh Ghat. Advance to Varanasi (Tile 14). If you pass START, collect ₹1,500.', action: 'advanceVaranasi' },
  { text: 'Sabarmati Riverfront Development: Advance to Ahmedabad (Tile 26) for the smart-city infra convention. If you pass START, collect ₹1,500.', action: 'advanceAhmedabad' },
  { text: 'Durga Puja Carnival in Kolkata: Festive celebration in the City of Joy! Advance to Kolkata (Tile 31). If you pass START, collect ₹1,500.', action: 'advanceKolkata' },
  { text: 'Post Office NSC Matured: National Savings Certificate 5-year deposit matured with sovereign interest! Collect ₹1,200.', amount: 1200 },
  { text: 'State Bank Fixed Deposit: Long-term fixed term deposit matured with cumulative interest. Collect ₹2,000.', amount: 2000 },
  { text: 'Family Wedding Shagun: Auspicious family celebration! Relatives bestow cash envelopes. Collect ₹150 from every player.', action: 'weddingGift' },
  { text: 'All India Radio Quiz Champion: You won the National Knowledge Bowl broadcast! Collect 200× your dice roll.', action: 'radioContest200' },
  { text: 'Startup India Seed Grant: Department for Promotion of Industry grant awarded! Collect ₹1,500.', amount: 1500 },
  { text: 'PM Fasal Bima Crop Insurance: Agri-tech crop yield protection settlement disbursed. Collect ₹1,000.', amount: 1000 },
  { text: 'High-Speed Rail Advisory: Technical consultancy retainer for the Bullet Train corridor. Collect ₹800.', amount: 800 },
  { text: 'ASI Heritage Conservation Award: Archaeological Survey recognition for monument preservation. Collect ₹750.', amount: 750 },
  { text: 'Income Tax Assessment Refund: Centralized Processing Centre automated tax refund credited via ECS. Collect ₹500.', amount: 500 },
  { text: 'Reserve Bank Sovereign Gold Bond: Semi-annual sovereign gold bond interest payout credited. Collect ₹400.', amount: 400 },
  { text: 'Municipal Water & Power Rebate: Energy-efficient appliance installation incentive. Collect ₹250.', amount: 250 },
  { text: 'Municipal Property Renovation: City corporation structural safety audit. Pay ₹200 per house, ₹800 per hotel.', action: 'repair' },
  { text: 'Apollo Super-Speciality Hospitalization: Private medical care and diagnostics invoice. Pay ₹1,000.', amount: -1000 },
  { text: 'CBSE School & Coaching Tuition: Annual senior secondary tuition and competitive entrance fees. Pay ₹500.', amount: -500 },
  { text: 'Society RWA Annual Maintenance: Gated community lift maintenance, diesel generator fund, and security fees. Pay ₹400.', amount: -400 },
  { text: 'Akshaya Patra Charity Contribution: Charitable support for government school mid-day meal programs. Pay ₹300.', amount: -300 },
  { text: 'Commercial Water Tanker Charges: Summer emergency private water supply delivery. Pay ₹200.', amount: -200 },
  { text: 'State Electricity Regulatory Cess: Grid transmission surcharge and clean energy cess. Pay ₹150.', amount: -150 },
  { text: 'Contempt of Court Order: High Court summons ignored. Go directly to Jail! Do not pass START, do not collect ₹1,500.', action: 'jail' },
  { text: 'Supreme Court Bail Order: Urgent writ petition granted! Get Out of Jail Free. Keep this card until needed or trade it.', action: 'jailfree' }
];
