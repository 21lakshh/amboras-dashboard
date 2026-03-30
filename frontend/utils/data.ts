export interface RevenueData {
  name: string
  value: number
}

export interface GuestsData {
  name: string
  value: number
}

export interface RoomsData {
  name: string
  occupied: number
  booked: number
  available: number
}

export interface FoodOrdersChartData {
  name: string
  value: number
}

export interface BookingData {
  id: number
  name: string
  phone: string
  bookingId: string
  nights: number
  roomType: string | string[]
  guests: number
  paid: string
  cost: string
  avatar: string
}

export interface FoodOrder {
  id: string
  guest: string
  room: string
  items: string[]
  total: string
  status: string
  time: string
}

export interface InvoiceItem {
  description: string
  amount: string
}

export interface Invoice {
  id: string
  guest: string
  date: string
  amount: string
  status: string
  items: InvoiceItem[]
}

export interface CalendarEvent {
  date: number
  guest: string
  nights: number
  guests: number
}

export const revenueData: RevenueData[] = [
  { name: "Sun", value: 8 },
  { name: "Mon", value: 10 },
  { name: "Tue", value: 12 },
  { name: "Wed", value: 11 },
  { name: "Thu", value: 9 },
  { name: "Fri", value: 11 },
  { name: "Sat", value: 12 },
]

export const guestsData: GuestsData[] = [
  { name: "Sun", value: 8000 },
  { name: "Mon", value: 10000 },
  { name: "Tue", value: 12000 },
  { name: "Wed", value: 9000 },
  { name: "Thu", value: 6000 },
  { name: "Fri", value: 8000 },
]

export const roomsData: RoomsData[] = [
  { name: "Sun", occupied: 15, booked: 10, available: 25 },
  { name: "Mon", occupied: 20, booked: 12, available: 18 },
  { name: "Tue", occupied: 18, booked: 15, available: 17 },
  { name: "Wed", occupied: 22, booked: 10, available: 18 },
  { name: "Thu", occupied: 20, booked: 15, available: 15 },
  { name: "Fri", occupied: 18, booked: 12, available: 20 },
  { name: "Sat", occupied: 15, booked: 10, available: 25 },
]

export const foodOrdersData: FoodOrdersChartData[] = [
  { name: "Breakfast", value: 35 },
  { name: "Lunch", value: 45 },
  { name: "Dinner", value: 55 },
  { name: "Room Service", value: 25 },
]

export const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"]

export const bookingData: BookingData[] = [
  {
    id: 1,
    name: "Ram Kailash",
    phone: "9905598912",
    bookingId: "SDK89635",
    nights: 2,
    roomType: "1 King Room",
    guests: 2,
    paid: "rsp.150",
    cost: "rsp.1500",
    avatar: "/placeholder.svg?height=32&width=32",
  },
  {
    id: 2,
    name: "Samira Karki",
    phone: "9815394203",
    bookingId: "SDK89635",
    nights: 4,
    roomType: ["1 Queen", "1 King Room"],
    guests: 5,
    paid: "paid",
    cost: "rsp.5500",
    avatar: "/placeholder.svg?height=32&width=32",
  },
  {
    id: 3,
    name: "Jeevan Rai",
    phone: "9865328452",
    bookingId: "SDK89635",
    nights: 1,
    roomType: ["1 Deluxe", "1 King Room"],
    guests: 3,
    paid: "rsp.150",
    cost: "rsp.2500",
    avatar: "/placeholder.svg?height=32&width=32",
  },
  {
    id: 4,
    name: "Bindu Sharma",
    phone: "9845653124",
    bookingId: "SDK89635",
    nights: 3,
    roomType: ["1 Deluxe", "1 King Room"],
    guests: 2,
    paid: "rsp.150",
    cost: "rsp.3000",
    avatar: "/placeholder.svg?height=32&width=32",
  },
]

export const foodOrders: FoodOrder[] = [
  {
    id: "FO-1234",
    guest: "Ram Kailash",
    room: "101",
    items: ["Chicken Curry", "Naan Bread", "Rice"],
    total: "rsp.850",
    status: "Delivered",
    time: "12:30 PM",
  },
  {
    id: "FO-1235",
    guest: "Samira Karki",
    room: "205",
    items: ["Vegetable Pasta", "Garlic Bread", "Tiramisu"],
    total: "rsp.1200",
    status: "Preparing",
    time: "1:15 PM",
  },
  {
    id: "FO-1236",
    guest: "Jeevan Rai",
    room: "310",
    items: ["Club Sandwich", "French Fries", "Coke"],
    total: "rsp.650",
    status: "On the way",
    time: "1:45 PM",
  },
]

export const invoices: Invoice[] = [
  {
    id: "INV-2023-001",
    guest: "Ram Kailash",
    date: "26 Jul 2023",
    amount: "rsp.1500",
    status: "Paid",
    items: [
      { description: "Room Charges (2 nights)", amount: "rsp.1200" },
      { description: "Food & Beverages", amount: "rsp.300" },
    ],
  },
  {
    id: "INV-2023-002",
    guest: "Samira Karki",
    date: "25 Jul 2023",
    amount: "rsp.5500",
    status: "Paid",
    items: [
      { description: "Room Charges (4 nights)", amount: "rsp.4800" },
      { description: "Food & Beverages", amount: "rsp.700" },
    ],
  },
  {
    id: "INV-2023-003",
    guest: "Jeevan Rai",
    date: "24 Jul 2023",
    amount: "rsp.2500",
    status: "Pending",
    items: [
      { description: "Room Charges (1 night)", amount: "rsp.2000" },
      { description: "Food & Beverages", amount: "rsp.500" },
    ],
  },
]

export const calendarEvents: CalendarEvent[] = [
  { date: 2, guest: "Carl Larson II", nights: 2, guests: 2 },
  { date: 9, guest: "Mrs. Emmett Morar", nights: 2, guests: 2 },
  { date: 24, guest: "Marjorie Klocko", nights: 2, guests: 2 },
]
