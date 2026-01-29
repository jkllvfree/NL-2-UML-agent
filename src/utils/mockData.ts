// mockData.ts
import { type Stage2Output } from "../types/diagram.js";

export const MOCK_ORDER_SYSTEM: Stage2Output = {
  nodeDataArray: [
    {
      key: 1,
      name: "Order",
      stereotype: "Class",
      properties: [
        { name: "orderId", type: "string", visibility: "private" },
        { name: "createTime", type: "Date", visibility: "private" },
        { name: "totalAmount", type: "number", visibility: "private" },
      ],
      methods: [
        {
          name: "calculateTotal",
          parameters: [],
          type: "number",
          visibility: "public",
        },
        { name: "pay", parameters: [], type: "boolean", visibility: "public" },
      ],
      loc: "0 0",
    },
    {
      key: 2,
      name: "OrderItem",
      stereotype: "Class",
      properties: [
        { name: "quantity", type: "number", visibility: "private" },
        { name: "priceSnapshot", type: "number", visibility: "private" },
      ],
      methods: [],
      loc: "250 0",
    },
    {
      key: 3,
      name: "Product",
      stereotype: "Class",
      properties: [
        { name: "name", type: "string", visibility: "private" },
        { name: "price", type: "number", visibility: "private" },
      ],
      methods: [
        {
          name: "updatePrice",
          parameters: [{ name: "newPrice", type: "number" }],
          type: "void",
          visibility: "public",
        },
      ],
      loc: "500 0",
    },
  ],
  linkDataArray: [
    {
      source: "Order",
      target: "OrderItem",
      relationship: "composition",
      sourceText: "1",
      targetText: "1..*",
    },
    {
      source: "OrderItem",
      target: "Product",
      relationship: "association",
      sourceText: "*",
      targetText: "1",
    },
  ],
};
