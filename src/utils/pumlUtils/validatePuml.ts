/**
 * 验证 PUML 转换函数的正确性
 * 运行: npx tsx agent/src/utils/pumlUtils/validatePuml.ts
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { convertClassJsonToPuml, convertSequenceJsonToPuml } from "./convertToPuml.js";
import type { LeafModel, SequenceView } from "../../types/diagram.js";

const TMP_DIR = path.join(process.cwd(), "tmp_puml_test");

// ---------- sample class diagram data ----------

const sampleClassModel: LeafModel = {
  description: "订单管理模块，管理订单的创建、支付、取消及订单项生命周期",
  classifiers: [
    {
      classifier_id: "cls_order_001",
      name: "Order",
      kind: "Entity",
      module_id: "M01",
      stereotype: "AggregateRoot",
      businessMeaning: "订单聚合根，表示一次购买行为产生的订单",
      responsibilities: ["管理订单生命周期", "协调订单项与支付"],
      businessRules: ["订单金额必须大于0", "订单状态流转必须符合规则"],
      attributes: [
        { name: "orderId", type: "string" },
        { name: "amount", type: "number", multiplicity: "1" },
        { name: "status", type: "OrderStatus" },
        { name: "createdAt", type: "Date" },
      ],
      operations: [
        {
          name: "createOrder",
          returnType: "Order",
          parameters: [
            { name: "customerId", type: "string" },
            { name: "items", type: "OrderItem[]" },
          ],
          businessGoal: "创建新订单并初始化订单项",
          preconditions: ["客户存在且状态正常"],
          postconditions: ["订单已创建，状态为 PENDING"],
        },
        {
          name: "cancelOrder",
          parameters: [],
          businessGoal: "取消订单并释放库存",
          preconditions: ["订单状态为 PENDING 或 CONFIRMED"],
          postconditions: ["订单状态为 CANCELLED", "库存已释放"],
        },
      ],
      dependencies: [
        {
          target: "cls_order_item_001",
          kind: "composition",
          multiplicityFrom: "1",
          multiplicityTo: "*",
          businessRelation: "包含",
        },
        {
          target: "cls_payment_001",
          kind: "association",
          multiplicityFrom: "1",
          multiplicityTo: "1",
          businessRelation: "关联支付",
        },
      ],
    },
    {
      classifier_id: "cls_order_item_001",
      name: "OrderItem",
      kind: "Entity",
      module_id: "M01",
      stereotype: "Entity",
      businessMeaning: "订单项，表示订单中的单个商品明细",
      responsibilities: ["记录商品数量与单价"],
      businessRules: ["数量必须为正整数", "单价必须大于0"],
      attributes: [
        { name: "itemId", type: "string" },
        { name: "productName", type: "string" },
        { name: "quantity", type: "number" },
        { name: "unitPrice", type: "number" },
      ],
      operations: [
        {
          name: "calculateSubtotal",
          returnType: "number",
          parameters: [],
          businessGoal: "计算当前订单项小计金额",
          preconditions: [],
          postconditions: ["返回 quantity * unitPrice"],
        },
      ],
      dependencies: [],
    },
    {
      classifier_id: "cls_payment_001",
      name: "Payment",
      kind: "Entity",
      module_id: "M01",
      stereotype: "Entity",
      businessMeaning: "支付记录，跟踪订单的支付信息",
      responsibilities: ["记录支付金额与状态"],
      businessRules: ["支付金额不可为负"],
      attributes: [
        { name: "paymentId", type: "string" },
        { name: "payAmount", type: "number" },
        { name: "payMethod", type: "string" },
      ],
      operations: [
        {
          name: "processPayment",
          returnType: "boolean",
          parameters: [{ name: "amount", type: "number" }],
          businessGoal: "执行支付操作",
          preconditions: ["订单状态为 PENDING"],
          postconditions: ["支付记录已创建", "订单状态更新为 PAID"],
        },
      ],
      dependencies: [],
    },
    {
      classifier_id: "cls_order_status_001",
      name: "OrderStatus",
      kind: "Enum",
      module_id: "M01",
      stereotype: "ValueObject",
      businessMeaning: "订单状态枚举：PENDING, CONFIRMED, PAID, CANCELLED, COMPLETED",
      responsibilities: [],
      businessRules: [],
      attributes: [],
      operations: [],
      dependencies: [],
    },
  ],
};

// ---------- sample sequence diagram data ----------

const sampleSequenceView: SequenceView = {
  module_id: "M01",
  module_name: "订单管理",
  schema_version: "0.1.0",
  interactions: [
    {
      description: "客户创建订单的完整业务流程，包含库存检查和支付发起",
      interaction_id: "interaction_create_order",
      name: "创建订单",
      module_id: "M01",
      use_case_id: "FR-M01-001",
      preconditions: ["客户已登录", "购物车非空"],
      postconditions: ["订单已创建并持久化", "库存已预占"],
      businessOutcome: "客户成功下单，订单进入待支付状态",
      context: {
        variables: [
          { name: "customerId", type: "string", initialValue: "CUST001" },
          { name: "cartId", type: "string", initialValue: "CART001" },
        ],
      },
      lifelines: [
        {
          lifeline_id: "lf_customer",
          name: "Customer",
          isActor: true,
          role: "Actor",
          businessResponsibility: "发起订单创建请求",
        },
        {
          lifeline_id: "lf_order_service",
          name: "OrderService",
          isActor: false,
          classifier_id: "cls_order_service",
          role: "Service",
          businessResponsibility: "协调订单创建流程",
        },
        {
          lifeline_id: "lf_inventory",
          name: "InventoryService",
          isActor: false,
          classifier_id: "cls_inventory_service",
          role: "Service",
          businessResponsibility: "检查并预占库存",
        },
        {
          lifeline_id: "lf_payment_gw",
          name: "PaymentGateway",
          isActor: false,
          role: "ExternalSystem",
          businessResponsibility: "第三方支付网关",
        },
      ],
      sequence: {
        elements: [
          {
            element_id: "msg_001",
            type: "Message",
            message: {
              message_kind: "request",
              name: "提交订单",
              sequence_number: "1",
              source: { lifeline_id: "lf_customer" },
              target: { lifeline_id: "lf_order_service" },
              businessGoal: "客户发起创建订单请求",
              businessResult: "订单创建流程启动",
              businessRuleRefs: ["BR-001 订单金额校验"],
              outputs: ["订单创建请求已接收"],
            },
          },
          {
            element_id: "frag_001",
            type: "Fragment",
            fragment: {
              fragment_type: "alt",
              businessPurpose: "根据库存是否充足决定后续流程",
              operands: [
                {
                  operand_id: "op_001",
                  guardCondition: "库存充足",
                  elements: [
                    {
                      element_id: "msg_002",
                      type: "Message",
                      message: {
                        message_kind: "request",
                        name: "预占库存",
                        sequence_number: "2",
                        source: { lifeline_id: "lf_order_service" },
                        target: { lifeline_id: "lf_inventory" },
                        businessGoal: "锁定订单所需库存",
                        businessResult: "库存已预占",
                        businessRuleRefs: [],
                        outputs: ["库存预占记录ID"],
                      },
                    },
                    {
                      element_id: "msg_003",
                      type: "Message",
                      message: {
                        message_kind: "request",
                        name: "创建支付",
                        sequence_number: "3a",
                        source: { lifeline_id: "lf_order_service" },
                        target: { lifeline_id: "lf_payment_gw" },
                        businessGoal: "发起支付请求",
                        businessResult: "支付单已创建",
                        businessRuleRefs: [],
                        outputs: ["支付单号"],
                      },
                    },
                    {
                      element_id: "msg_005",
                      type: "Message",
                      message: {
                        message_kind: "response",
                        name: "支付结果",
                        sequence_number: "4a",
                        source: { lifeline_id: "lf_payment_gw" },
                        target: { lifeline_id: "lf_order_service" },
                        businessGoal: "返回支付处理结果",
                        businessResult: "支付处理完成",
                        businessRuleRefs: [],
                        outputs: ["支付状态"],
                      },
                    },
                  ],
                },
                {
                  operand_id: "op_002",
                  guardCondition: "库存不足",
                  elements: [
                    {
                      element_id: "msg_004",
                      type: "Message",
                      message: {
                        message_kind: "response",
                        name: "库存不足通知",
                        sequence_number: "3b",
                        source: { lifeline_id: "lf_order_service" },
                        target: { lifeline_id: "lf_customer" },
                        businessGoal: "告知客户库存不足",
                        businessResult: "客户收到库存不足提示",
                        businessRuleRefs: [],
                        outputs: ["库存不足错误信息"],
                      },
                    },
                  ],
                },
              ],
            },
          },
          {
            element_id: "msg_006",
            type: "Message",
            message: {
              message_kind: "response",
              name: "订单创建结果",
              sequence_number: "5",
              source: { lifeline_id: "lf_order_service" },
              target: { lifeline_id: "lf_customer" },
              businessGoal: "告知客户订单创建结果",
              businessResult: "客户看到订单确认页",
              businessRuleRefs: [],
              outputs: ["订单ID", "订单状态"],
            },
          },
        ],
      },
    },
    {
      description: "客户取消已有订单",
      interaction_id: "interaction_cancel_order",
      name: "取消订单",
      module_id: "M01",
      use_case_id: "FR-M01-002",
      preconditions: ["订单存在且状态为 PENDING 或 CONFIRMED"],
      postconditions: ["订单状态为 CANCELLED", "库存已释放"],
      businessOutcome: "订单成功取消，库存回退",
      context: {
        variables: [{ name: "orderId", type: "string", initialValue: "ORD001" }],
      },
      lifelines: [
        {
          lifeline_id: "lf_customer2",
          name: "Customer",
          isActor: true,
          role: "Actor",
          businessResponsibility: "发起取消订单请求",
        },
        {
          lifeline_id: "lf_order_service2",
          name: "OrderService",
          isActor: false,
          classifier_id: "cls_order_service",
          role: "Service",
          businessResponsibility: "处理订单取消",
        },
      ],
      sequence: {
        elements: [
          {
            element_id: "msg_cancel_001",
            type: "Message",
            message: {
              message_kind: "request",
              name: "取消订单",
              sequence_number: "1",
              source: { lifeline_id: "lf_customer2" },
              target: { lifeline_id: "lf_order_service2" },
              guard: "订单可取消",
              businessGoal: "客户请求取消订单",
              businessResult: "取消流程启动",
              businessRuleRefs: ["BR-002 取消时效限制"],
              outputs: [],
            },
          },
        ],
      },
    },
  ],
};

// ---------- validation ----------

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function validateWithPlantUML(pumlContent: string, label: string): boolean {
  const pumlPath = path.join(TMP_DIR, `${label}.puml`);
  fs.writeFileSync(pumlPath, pumlContent, "utf-8");

  try {
    // 1. 语法检查
    execSync(`plantuml --check-syntax "${pumlPath}"`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    console.log(`[${label}] PlantUML 语法校验通过`);

    // 2. 实际渲染测试 (pipe 模式生成 SVG)
    const svgOutput = execSync(`plantuml -tsvg -pipe < "${pumlPath}"`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    if (svgOutput.includes("<svg") && svgOutput.includes("</svg>")) {
      console.log(`[${label}] PlantUML SVG 渲染成功 (${svgOutput.length} 字节)`);
      return true;
    }
    console.error(`[${label}] PlantUML SVG 渲染失败: 输出中未找到 SVG 标签`);
    console.error(`   输出前 200 字符: ${svgOutput.substring(0, 200)}`);
    return false;
  } catch (err: any) {
    const stderr = err.stderr || err.stdout || err.message;
    console.error(`[${label}] PlantUML 校验失败:\n${stderr}`);
    return false;
  }
}

function main() {
  ensureDir(TMP_DIR);
  let allPass = true;

  // --- 类图 ---
  console.log("\n 测试类图 PUML 转换...");
  const classPuml = convertClassJsonToPuml(sampleClassModel);
  console.log("--- 生成的类图 PUML ---");
  console.log(classPuml);
  console.log("--- PUML 结束 ---\n");
  if (!validateWithPlantUML(classPuml, "class_diagram")) allPass = false;

  // --- 时序图 ---
  console.log("\n 测试时序图 PUML 转换...");
  const seqPuml = convertSequenceJsonToPuml(sampleSequenceView);
  console.log("--- 生成的时序图 PUML ---");
  console.log(seqPuml);
  console.log("--- PUML 结束 ---\n");
  if (!validateWithPlantUML(seqPuml, "sequence_diagram")) allPass = false;

  // 清理
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  if (allPass) {
    console.log("\n所有 PUML 转换验证通过!");
  } else {
    console.error("\n存在 PUML 转换失败，请检查错误信息");
    process.exit(1);
  }
}

main();
