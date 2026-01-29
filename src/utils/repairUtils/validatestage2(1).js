// ============ 类型定义 ============
export interface ValidatedResult {
  identified_classes?: string[];
  potential_relationships?: Relationship[];
  ambiguities?: string[];
  clarification_questions?: string[];
}

export interface Relationship {
  from: string;
  to: string;
  type: string;
  description?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  confidence?: number;
}

export interface ClassNode {
  key: number;
  name: string;
  stereotype: string;
  properties: ClassProperty[];
  methods: ClassMethod[];
  loc: string;
}

export interface ClassProperty {
  name: string;
  type: string;
  visibility: string;
  static?: boolean;
  final?: boolean;
}

export interface ClassMethod {
  name: string;
  parameters: MethodParameter[];
  type: string;
  visibility: string;
  static?: boolean;
  abstract?: boolean;
}

export interface MethodParameter {
  name: string;
  type: string;
}

export interface DiagramLink {
  from: number;
  to: number;
  relationship: string;
  text?: string;
  sourceText?: string;
  targetText?: string;
}

export interface DiagramData {
  nodeDataArray: ClassNode[];
  linkDataArray: DiagramLink[];
}

interface MultiplicityDefaults {
  source: string;
  target: string;
}

// ============ 转换器类 ============
export class ClassDiagramConverter {
  // 关系类型映射
  private relationshipMap: Record<string, string> = {
    inheritance: 'inheritance',
    generalization: 'inheritance',
    extends: 'inheritance',
    realization: 'realization',
    implements: 'realization',
    association: 'association',
    aggregation: 'aggregation',
    composition: 'composition',
    dependency: 'dependency',
    uses: 'dependency'
  };
  
  // 默认关系文本
  private defaultRelationshipTexts: Record<string, string> = {
    inheritance: 'extends',
    realization: 'implements',
    association: '',
    aggregation: 'has',
    composition: 'contains',
    dependency: 'uses'
  };
  
  // 多重性格式映射
  private multiplicityPatterns: Record<string, string> = {
    '0..*': '0..*',
    '0..1': '0..1',
    '1..*': '1..*',
    '*': '*',
    '0': '0',
    '1': '1',
    'n': '*',
    'many': '*',
    'zero': '0',
    'one': '1'
  };

  /**
   * 阶段二：将验证后的结果转换为GoJS类图数据格式
   */
  public validateAndNormalizeResult_2(validatedResult: ValidatedResult): DiagramData {
    if (!validatedResult || typeof validatedResult !== 'object') {
      return this.getEmptyDiagramData_2();
    }
    
    const diagramData: DiagramData = {
      nodeDataArray: [],
      linkDataArray: []
    };
    
    // 转换节点数据
    if (validatedResult.identified_classes && Array.isArray(validatedResult.identified_classes)) {
      diagramData.nodeDataArray = this.convertClassesToNodes_2(validatedResult.identified_classes);
    }
    
    // 转换链接数据
    if (validatedResult.potential_relationships && Array.isArray(validatedResult.potential_relationships)) {
      diagramData.linkDataArray = this.convertRelationshipsToLinks_2(
        validatedResult.potential_relationships, 
        diagramData.nodeDataArray
      );
    }
    
    // 验证节点存在性并转换类名为key
    this.validateAndConvertNodeLinks_2(diagramData);
    
    return diagramData;
  }

  /**
   * 转换类名为节点数据
   */
  private convertClassesToNodes_2(classNames: string[]): ClassNode[] {
    const nodes: ClassNode[] = [];
    const existingNames = new Set<string>();
    
    // 网格布局参数
    const gridSize = Math.ceil(Math.sqrt(classNames.length));
    const nodeWidth = 150;
    const nodeHeight = 200;
    const spacing = 250;
    const startX = 100;
    const startY = 100;
    
    classNames.forEach((className: string, index: number) => {
      // 确保类名唯一
      let uniqueName = className;
      let counter = 1;
      while (existingNames.has(uniqueName)) {
        uniqueName = `${className}${counter}`;
        counter++;
      }
      existingNames.add(uniqueName);
      
      // 计算网格位置
      const row = Math.floor(index / gridSize);
      const col = index % gridSize;
      const x = startX + col * (nodeWidth + spacing);
      const y = startY + row * (nodeHeight + spacing);
      
      nodes.push({
        key: index + 1,  // key从1开始递增
        name: uniqueName,
        stereotype: 'Class',
        properties: [],  // 留空，由LLM填充
        methods: [],     // 留空，由LLM填充
        loc: `${x} ${y}`
      });
    });
    
    return nodes;
  }

  /**
   * 转换关系为链接数据
   */
  private convertRelationshipsToLinks_2(relationships: Relationship[], nodes: ClassNode[]): any[] {
    // 创建类名到key的映射
    const nameToKeyMap: Record<string, number> = {};
    nodes.forEach((node: ClassNode) => {
      nameToKeyMap[node.name] = node.key;
    });
    
    const links: any[] = [];
    
    relationships.forEach((relationship: Relationship) => {
      // 标准化关系类型
      const type = relationship.type.toLowerCase();
      const normalizedType = this.relationshipMap[type] || 'association';
      
      const link: any = {
        source: relationship.from,  // 暂时存储类名（用于验证）
        target: relationship.to,    // 暂时存储类名（用于验证）
        relationship: normalizedType,
        text: relationship.description || '',
        sourceText: relationship.sourceMultiplicity || '',
        targetText: relationship.targetMultiplicity || ''
      };
      
      // 如果没有提供多重性，为某些关系类型设置默认值
      if (!link.sourceText || !link.targetText) {
        const defaultMultiplicity = this.getDefaultMultiplicity_2(normalizedType);
        link.sourceText = link.sourceText || defaultMultiplicity.source;
        link.targetText = link.targetText || defaultMultiplicity.target;
      }
      
      // 如果没有提供文本标签，根据关系类型设置默认标签
      if (!link.text) {
        link.text = this.getDefaultRelationshipText_2(normalizedType);
      }
      
      // 确保多重性格式正确
      link.sourceText = this.normalizeMultiplicity_2(link.sourceText);
      link.targetText = this.normalizeMultiplicity_2(link.targetText);
      
      // 记录对应的key（用于后续转换）
      link.fromKey = nameToKeyMap[relationship.from];
      link.toKey = nameToKeyMap[relationship.to];
      
      links.push(link);
    });
    
    return links;
  }

  /**
   * 验证节点存在性并转换类名为key
   */
  private validateAndConvertNodeLinks_2(diagramData: DiagramData): void {
    const nodeNames = new Set<string>(diagramData.nodeDataArray.map((node: ClassNode) => node.name));
    const nameToKeyMap: Record<string, number> = {};
    
    // 创建类名到key的映射
    diagramData.nodeDataArray.forEach((node: ClassNode) => {
      nameToKeyMap[node.name] = node.key;
    });
    
    // 过滤并转换链接数据
    diagramData.linkDataArray = diagramData.linkDataArray
      .filter((link: any) => {
        const sourceExists = nodeNames.has(link.source);
        const targetExists = nodeNames.has(link.target);
        
        if (!sourceExists || !targetExists) {
          console.warn(`链接被忽略：节点 "${link.source}" 或 "${link.target}" 不存在`);
          return false;
        }
        
        // 避免自引用（除非是继承/实现）
        if (link.source === link.target && 
            link.relationship !== 'inheritance' && 
            link.relationship !== 'realization') {
          console.warn(`链接被忽略：自引用关系 "${link.source}" -> "${link.target}"`);
          return false;
        }
        
        return true;
      })
      .map((link: any): DiagramLink => {
        // 转换为最终格式，使用from/to字段，值为key
        const newLink: DiagramLink = {
          from: nameToKeyMap[link.source],
          to: nameToKeyMap[link.target],
          relationship: link.relationship,
          text: link.text,
          sourceText: link.sourceText,
          targetText: link.targetText
        };
        
        return newLink;
      });
  }

  /**
   * 获取默认多重性设置
   */
  private getDefaultMultiplicity_2(relationshipType: string): MultiplicityDefaults {
    switch (relationshipType) {
      case 'composition':
        return { source: '1', target: '1..*' };
      case 'aggregation':
        return { source: '1', target: '0..*' };
      case 'association':
        return { source: '*', target: '*' };
      case 'inheritance':
      case 'realization':
      case 'dependency':
      default:
        return { source: '', target: '' };
    }
  }

  /**
   * 获取默认关系文本
   */
  private getDefaultRelationshipText_2(relationshipType: string): string {
    return this.defaultRelationshipTexts[relationshipType] || '';
  }

  /**
   * 标准化多重性格式
   */
  private normalizeMultiplicity_2(multiplicity: string): string {
    if (!multiplicity || multiplicity.trim() === '') {
      return '';
    }
    
    const trimmed = multiplicity.trim();
    const lowerKey = trimmed.toLowerCase();
    return this.multiplicityPatterns[lowerKey] || trimmed;
  }

  /**
   * 获取空的图表数据
   */
  private getEmptyDiagramData_2(): DiagramData {
    return {
      nodeDataArray: [],
      linkDataArray: []
    };
  }
}