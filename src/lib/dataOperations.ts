import type { AgentConversation, CharacterConversation, TaskRecord } from '../types'
import { isCharacterImageJobActive } from './characterImageJobState'

export function hasActiveDataOperations(tasks: TaskRecord[], agentConversations: AgentConversation[], characterConversations: CharacterConversation[] = []) {
  return tasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)
    || agentConversations.some((conversation) => conversation.rounds.some((round) => round.status === 'running'))
    || characterConversations.some((conversation) => conversation.messages.some((msg) => msg.status === 'replying' || msg.status === 'imaging' || msg.imageJobs?.some(isCharacterImageJobActive)))
}
