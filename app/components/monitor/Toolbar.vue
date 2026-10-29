<script setup lang="ts">
defineProps<{ minutes: 1 | 5 | 15; paused: boolean; message: string }>();
const emit = defineEmits<{ range: [value: 1 | 5 | 15]; pause: [] }>();
const ranges = [1, 5, 15] as const;
</script>

<template>
  <header
    class="mb-6 flex min-h-9 items-center justify-between gap-3 max-[480px]:flex-wrap max-[480px]:justify-end"
  >
    <span
      class="text-xs text-muted max-[480px]:w-full max-[480px]:text-right max-[480px]:empty:hidden"
      role="status"
      >{{ message }}</span
    >
    <div class="flex shrink-0 items-center gap-4">
      <div class="flex items-center gap-1" role="group" aria-label="时间范围">
        <UButton
          v-for="range in ranges"
          :key="range"
          color="neutral"
          :variant="minutes === range ? 'soft' : 'ghost'"
          size="sm"
          :aria-pressed="minutes === range"
          @click="emit('range', range)"
          >{{ range }} 分钟</UButton
        >
      </div>
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        class="min-w-14 justify-center"
        :aria-pressed="paused"
        @click="emit('pause')"
        >{{ paused ? "继续" : "暂停" }}</UButton
      >
    </div>
  </header>
</template>
